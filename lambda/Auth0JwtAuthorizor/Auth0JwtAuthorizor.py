from __future__ import print_function
import json
import os
import base64
import re
import urllib2
import boto3
from neo4j.v1 import GraphDatabase, basic_auth, constants
import logging
import sblambda
from awspol import AuthPolicy, HttpVerb
import ast
import jwt
from cryptography.x509 import load_pem_x509_certificate
from cryptography.hazmat.backends import default_backend

logger = None
AUTH0_AUDIENCE = os.environ["AUTH0_AUDIENCE"]
AUTH0_CREDS_BUCKET = os.environ["AUTH0_CREDS_BUCKET"]
AUTH0_CREDS_OBJECT = os.environ["AUTH0_CREDS_OBJECT"]

if 'LOGGING_LEVEL' in os.environ:
  LOGGING_LEVEL = int(os.environ["LOGGING_LEVEL"])
else:
  LOGGING_LEVEL = 30

if 'REVALIDATE_USER' in os.environ:
  REVALIDATE_USER = ast.literal_eval(os.environ["REVALIDATE_USER"])
else:
  REVALIDATE_USER = True

logger = logging.getLogger()
logger.setLevel(LOGGING_LEVEL)

def add_update_user(user, jwt, decodedjwt):
    global REVALIDATE_USER

    data = { "id_token": jwt }

    profile = {}
    name = '<default>'
    first_name = None
    last_name = None
    email = '<default>'
    picture = '<default>'
    email = '<default>'
    description = '<default>'
    emailVerified = True

    try:
      req = urllib2.Request(
          	url = '%s%s' % (decodedjwt['iss'], 'tokeninfo'),
          	headers = {"Content-type": "application/json"},
  	        data = json.dumps(data))
        
      f = urllib2.urlopen(url = req)
      jsonProfile = f.read()
      profile = json.loads(jsonProfile)
      logger.debug(jsonProfile)

    except urllib2.HTTPError as h:
      if REVALIDATE_USER:
        raise
      else:
        name = 'UNVALIDATED USER'
        description = 'UNVALIDATED USER: SHOULD ONLY SEE IN TEST'
        logger.warning('Allowing unvalidated user to proceed (REVALIDATE_USER=%s). User: "%s"' % (REVALIDATE_USER, user))
        pass
    
    
    if 'name' in profile:
        name = profile['name']

    if 'picture' in profile:
        picture = profile['picture']
        
    if 'description' in profile:
        description = profile['description']

    if 'email' in profile:
        email = profile['email']

    if 'email_verified' in profile:
        if profile['email_verified'] == False:
          emailVerified = False

    if 'given_name' in profile:
        first_name = profile['given_name']
    elif 'user_metadata' in profile and 'given_name' in profile['user_metadata']:
        first_name = profile['user_metadata']['given_name']

    if 'family_name' in profile:
        last_name = profile['family_name']
    elif 'user_metadata' in profile and 'family_name' in profile['user_metadata']:
        last_name = profile['user_metadata']['family_name']


    query = """
    MERGE
      (u:User {auth0_key: {auth0_key}})
    ON CREATE SET
      u.name={name},
      u.picture={picture},
      u.description={description},
      u.email={email},
      u.email_verified={emailVerified},
      u.lastAuthAt=timestamp(),
      u.createdAt=timestamp(),
      u.authCount=1
    ON MATCH SET
      u.picture={picture},
      u.description={description},
      u.email_verified={emailVerified},
      u.lastAuthAt=timestamp(),
      u.authCount = coalesce(u.authCount, 1) + 1
    RETURN u
    """
    session = sblambda.get_db_session()
    session.run(query,
      parameters={"auth0_key": user, "name": name, "picture": picture, "description": description, "email": email, "emailVerified": emailVerified}).consume()

    update_names_query = """
    MATCH
      (u:User {auth0_key: {auth0_key}})
    SET
      u.first_name={first_name},
      u.last_name={last_name}
    RETURN u
    """

    if first_name or last_name:
      session.run(update_names_query,
        parameters={"auth0_key": user, "first_name": first_name, "last_name": last_name}).consume()
    
    if session.healthy: 
        session.close() 

    return True

def get_public_key():
    global AUTH0_CREDS_BUCKET, AUTH0_CREDS_OBJECT

    s3 = boto3.client('s3')
    response = s3.get_object(Bucket=AUTH0_CREDS_BUCKET,Key=AUTH0_CREDS_OBJECT)
    contents = response['Body'].read()
    return contents

def lambda_handler(event, context):
    global LOGGING_LEVEL, AUTH0_AUDIENCE, logger


    creds = sblambda.get_creds('auth0')
    secret = creds['auth0_secret']
    encoded = event['authorizationToken']
    orig_audience = creds['auth0_audience']

    # TODO Handle expired signatures 
    # https://console.aws.amazon.com/cloudwatch/home?region=us-east-1#logEventViewer:group=/aws/lambda/Auth0JwtAuthorizor;stream=2017/01/23/%5B$LATEST%5D04afd1c304614be18654a7972aa6e935

    try:
      decoded_without_verification = jwt.decode(encoded, verify=False)
      logger.info('JWT token decoded: %s' % (json.dumps(decoded_without_verification)))

      if decoded_without_verification['aud'] == orig_audience:
        decoded = jwt.decode(encoded, secret, algorithms=['HS256'], audience=orig_audience)
      elif decoded_without_verification['aud'] == AUTH0_AUDIENCE:
        cert_obj = load_pem_x509_certificate(get_public_key(), default_backend())
        public_key = cert_obj.public_key()
        decoded = jwt.decode(encoded, public_key, algorithms=['RS256'], audience=AUTH0_AUDIENCE)
      else:
        raise jwt.InvalidAudienceError
   
      # don't skip adding user on read only 
      # if re.search("SandboxRunInstance$", event['methodArn']):
      add_update_user(decoded['sub'], encoded, decoded)

      tmp = event['methodArn'].split(':')
      apiGatewayArnTmp = tmp[5].split('/')
      awsAccountId = tmp[4]

      principalId = decoded['sub']

      policy = AuthPolicy(principalId, awsAccountId)
      policy.restApiId = apiGatewayArnTmp[0]
      policy.region = tmp[3]
      policy.stage = apiGatewayArnTmp[1]
#    policy.denyAllMethods()
      policy.allowMethod(HttpVerb.GET, 'SandboxGetRunningInstancesForUser')
      policy.allowMethod(HttpVerb.GET, 'SandboxRetrieveUserLogs')
      policy.allowMethod(HttpVerb.POST, 'SandboxRunInstance')
      policy.allowMethod(HttpVerb.POST, 'SandboxStopInstance')
      policy.allowMethod(HttpVerb.POST, 'SandboxBackupInstance')
      policy.allowMethod(HttpVerb.POST, 'SandboxExtend')
      policy.allowMethod(HttpVerb.POST, 'SandboxConditionalAddLead')
    except jwt.ExpiredSignatureError:
      logger.info('JWT token denied because expired')
      raise Exception('Unauthorized')

    # Finally, build the policy and exit the function using return
    return policy.build()

