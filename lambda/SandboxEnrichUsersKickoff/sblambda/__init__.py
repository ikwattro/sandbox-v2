import boto3
import json
import os
import base64
import time
import math
import logging
import urllib
import urllib2
from neo4j.v1 import GraphDatabase, basic_auth, constants

creds = {}
glob_driver = None
glob_auth0_mgmt_token = None
DEFAULT_LOGGING_LEVEL = 30
LOGGING_LEVEL = int(os.environ.get("LOGGING_LEVEL", DEFAULT_LOGGING_LEVEL))
DB_HOST = os.environ.get("DB_HOST", "neo4j")
DB_CREDS_BUCKET = os.environ.get("DB_CREDS_BUCKET", None)
AUTH0_MANAGEMENT_CREDS_OBJECT = os.environ.get("AUTH0_MANAGEMENT_CREDS_OBJECT", None)
AUTH0_MANAGEMENT_CREDS_BUCKET = os.environ.get("AUTH0_MANAGEMENT_CREDS_BUCKET", None)
TWITTER_APP_CREDS_OBJECT = os.environ.get("TWITTER_APP_CREDS_OBJECT", None)
TWITTER_APP_CREDS_BUCKET = os.environ.get("TWITTER_APP_CREDS_BUCKET", None)

logger = logging.getLogger()
logger.setLevel(LOGGING_LEVEL)

class MyEncoder(json.JSONEncoder):
    def default(self, obj):
        if isinstance(obj, datetime.datetime):
            return int(time.mktime(obj.timetuple()))

        return json.JSONEncoder.default(self, obj)

def decode_base64(data):
    """Decode base64, padding being optional.

    :param data: Base64 data as an ASCII byte string
    :returns: The decoded byte string.

    """
    data += '=' * (-len(data)% 4)
    return base64.decodestring(data)

def get_encrypted_object(bucket, key):
    s3 = boto3.client('s3')
    kms = boto3.client('kms')
    response = s3.get_object(Bucket=bucket,Key=key)
    contents = response['Body'].read()

    encryptedData = base64.b64decode(contents)
    decryptedResponse = kms.decrypt(CiphertextBlob = encryptedData)
    decryptedData = decryptedResponse['Plaintext']
    creds = json.loads(decryptedData)
    return creds

def get_creds(credName):
    global creds, DB_CREDS_BUCKET

    if credName in creds:
        return creds[credName]
    else:
        creds[credName] = get_encrypted_object(DB_CREDS_BUCKET, "%s.enc.cfg" % (credName))
        return creds[credName]

def get_db_creds():
    return get_creds('neo4j')

def get_db_driver():
    global glob_driver
    global DB_HOST

    if glob_driver:
      return glob_driver
    else:
      creds = get_db_creds()
      glob_driver = GraphDatabase.driver("bolt://%s" % (DB_HOST), auth=basic_auth(creds['user'], creds['password']), encrypted=False)
      return glob_driver

def get_db_session():
    driver = get_db_driver()
    return driver.session()

def decrypt_user_creds(encryptedPassword):
    kms = boto3.client('kms')
    binaryPassword = base64.b64decode(encryptedPassword)
    return (kms.decrypt(CiphertextBlob=binaryPassword))['Plaintext']

def get_auth0_management_clientinfo():
    global AUTH0_MANAGEMENT_CREDS_OBJECT, AUTH0_MANAGEMENT_CREDS_BUCKET
    return get_encrypted_object(AUTH0_MANAGEMENT_CREDS_BUCKET, AUTH0_MANAGEMENT_CREDS_OBJECT)

def get_auth0_management_token():
    global glob_auth0_mgmt_token

    # if we have a stored token, and it doesn't expire in the next
    # 2 minutes, return it instead of getting new one
    if (glob_auth0_mgmt_token and 
         ('expires' in glob_auth0_mgmt_token) and
         (time.time() + 120) < glob_auth0_mgmt_token['expires']):
      return glob_auth0_mgmt_token 

    authci = get_auth0_management_clientinfo()
    clientSecret = authci['client_secret']
    clientId = authci['client_id']
    audience = authci['audience']
    tokenEndpoint = authci['token_endpoint']
    apiEndpoint = authci['api_endpoint']

    payload_obj = {
      "grant_type": "client_credentials",
      "client_id": clientId,
      "client_secret": clientSecret,
      "audience": audience
    }
    req = urllib2.Request(
              url = tokenEndpoint,
              headers = {"Content-type": "application/json"},
              data = json.dumps(payload_obj))

    f = urllib2.urlopen(url = req)
    data = f.read()
    data_obj = json.loads(data.decode("utf-8"))
    # subtract 2 seconds from expires to be safe due to delay between issue
    # and this code processing
    return_obj = {
      "access_token": data_obj["access_token"],
      "expires": data_obj["expires_in"] + math.floor(time.time()) - 2,
      "api_endpoint": apiEndpoint
    }
    glob_auth0_mgmt_token = return_obj
    return glob_auth0_mgmt_token

def get_twitter_app_creds():
    global TWITTER_APP_CREDS_OBJECT, TWITTER_APP_CREDS_BUCKET
    return get_encrypted_object(TWITTER_APP_CREDS_BUCKET, TWITTER_APP_CREDS_OBJECT)

def get_twitter_bearer_token():
    global LOGGING_LEVEL

    twitterCreds = get_twitter_app_creds()
    username = twitterCreds['consumer_key']
    password = twitterCreds['consumer_secret']

    if LOGGING_LEVEL == 0:
      urllib2.install_opener(urllib2.build_opener(urllib2.HTTPSHandler(debuglevel=1)))

    payload_obj = {
      "grant_type": "client_credentials"
    }
    data = urllib.urlencode(payload_obj)

    base64string = base64.b64encode('%s:%s' % (username, password))

    req = urllib2.Request(data = data, url = 'https://api.twitter.com/oauth2/token')
    req.add_header("Authorization", "Basic %s" % base64string)  

    f = urllib2.urlopen(url = req)
    jsonToken = f.read()
    token = json.loads(jsonToken)
    logger.debug(json.dumps(token))
    return token 


def get_auth0_user_profile(user):
    global LOGGING_LEVEL

    apiInfo = get_auth0_management_token()

    if LOGGING_LEVEL == 0:
      urllib2.install_opener(urllib2.build_opener(urllib2.HTTPSHandler(debuglevel=1)))

    req = urllib2.Request(
              url = '%susers/%s' % (apiInfo['api_endpoint'], user),
              headers = {"Authorization": "bearer %s" % apiInfo['access_token'] })

    f = urllib2.urlopen(url = req)
    jsonProfile = f.read()
    profile = json.loads(jsonProfile)
    logger.debug(json.dumps(profile))
    return profile

def get_twitter_user_creds(user):
    profile = get_auth0_user_profile(user)
    for identity in profile['identities']:
        if identity['provider'] == 'twitter':
            return identity
    return false
