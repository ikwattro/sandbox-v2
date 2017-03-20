from __future__ import print_function
import json
from neo4j.v1 import GraphDatabase, basic_auth, constants
import boto3
import datetime
import time
import base64
import os
import logging
import traceback
import urllib
import urllib2
import urlparse
from string import Template

db_creds = None

DB_HOST = os.environ["DB_HOST"]
DB_CREDS_BUCKET = os.environ["DB_CREDS_BUCKET"]
DB_CREDS_OBJECT = os.environ["DB_CREDS_OBJECT"]

class MyEncoder(json.JSONEncoder):
    def default(self, obj):
        if isinstance(obj, datetime.datetime):
            return int(time.mktime(obj.timetuple()))

        return json.JSONEncoder.default(self, obj)


def get_db_creds():
    global db_creds
    global DB_CREDS_BUCKET
    global DB_CREDS_OBJECT

    if db_creds:
        return db_creds
    else:
        s3 = boto3.client('s3')
        kms = boto3.client('kms')
        response = s3.get_object(Bucket=DB_CREDS_BUCKET,Key=DB_CREDS_OBJECT)
        contents = response['Body'].read()

        encryptedData = base64.b64decode(contents)
        decryptedResponse = kms.decrypt(CiphertextBlob = encryptedData)
        decryptedData = decryptedResponse['Plaintext']
        db_creds = json.loads(decryptedData)
        return db_creds

creds = get_db_creds()
driver = GraphDatabase.driver("bolt://%s" % (DB_HOST), auth=basic_auth(creds['user'], creds['password']), encrypted=False)

def get_db_session():
    global creds
    global driver

    session = driver.session()
    return session

def update_fc_info(jsonData, whId):
    session = get_db_session()
    whIdSegments = whId.split(":")
    jsonData = json.loads(jsonData)
    if 'demographics' in jsonData and 'locationDeduced' in jsonData['demographics']:
      if not 'state' in jsonData['demographics']['locationDeduced']:
        jsonData['demographics']['locationDeduced']['state'] = {'name':'-'}
      if not 'country' in jsonData['demographics']['locationDeduced']:
        jsonData['demographics']['locationDeduced']['country'] = {'name':'-'}
      if not 'city' in jsonData['demographics']['locationDeduced']:
        jsonData['demographics']['locationDeduced']['city'] = {'name':'-'}
    if 'organizations' in jsonData:
      for i,org in enumerate(jsonData['organizations']):
        if not 'name' in jsonData['organizations'][i]:
          jsonData['organizations'][i]['name'] = '-'
        if not 'title' in jsonData['organizations'][i]:
          jsonData['organizations'][i]['title'] = '-'

    # store json first so its not lost if cypher error
    store_json_query = """
    UNWIND {jsonData} AS jd
    WITH jd

    MATCH 
      (u:User)
    WHERE 
      u.email = {email}
      AND
      id(u) = toInt({id})
    CALL apoc.convert.setJsonProperty(u,'fc_json',jd)
    RETURN true
    """

    results = session.run(store_json_query, parameters={"jsonData": jsonData, "email": whIdSegments[1], "id": whIdSegments[0]})
    results.consume()


    instances_query = """
    UNWIND {jsonData} AS jd

    WITH jd

    MATCH 
      (u:User)
    WHERE 
      u.email = {email}
      AND
      id(u) = toInt({id})
    SET
      u.fc_first_name = jd.contactInfo.givenName,
      u.fc_last_name = jd.contactInfo.familyName,
      u.fc_full_name = jd.contactInfo.fullName,
      u.fc_likelihood = jd.likelihood

    FOREACH (fcp IN jd.photos |
      MERGE 
        (u)-[hp:FC_HAS_PHOTO]->(ufcp:FcPhoto {type: fcp.type})
      SET
        ufcp.url = fcp.url,
        ufcp.isPrimary = fcp.isPrimary
    )

    WITH u,jd, 
       CASE jd.demographics.locationDeduced.city.name IS NOT NULL AND jd.demographics.locationDeduced.state.name IS NOT NULL AND jd.demographics.locationDeduced.country.name IS NOT NULL
       WHEN true THEN
         [true]
       ELSE 
         []
       END AS localeExists

    FOREACH (l IN localeExists |
      MERGE
        (fccn:FcCountry {name: jd.demographics.locationDeduced.country.name})
      MERGE
        (fcs:FcState {name: jd.demographics.locationDeduced.state.name})-[:FC_LOCATED_IN]->(fccn)
      MERGE
        (fcc:FcCity {name: jd.demographics.locationDeduced.city.name})-[:FC_LOCATED_IN]->(fcs)
      MERGE
        (u)-[:FC_LOCATED_IN_DEDUCED {likelihood: jd.demographics.locationDeduced.likelihood}]->(fcc) 
    )


    FOREACH (sp IN jd.socialProfiles |
      MERGE
        (fcsp:FcSocialProfile {url: sp.url})
      ON CREATE SET
        fcsp.type = sp.type,
        fcsp.username = sp.username,
        fcsp.bio = sp.bio,
        fcsp.id = sp.id,
        fcsp.followers = sp.followers,
        fcsp.following = sp.following
      ON MATCH SET
        fcsp.bio = sp.bio,
        fcsp.followers = sp.followers,
        fcsp.following = sp.following
      MERGE
        (u)-[fchsp:FC_HAS_SOCIAL_PROFILE]->(fcsp)
    )

    FOREACH (dfs IN jd.digitalFootprint.scores |
      MERGE 
        (u)-[:FC_HAS_FOOTPRINT_SCORE]->(fcfps:FcFootprintScore {provider: dfs.provider, type: dfs.type})
      ON MATCH SET
        fcfps.value = dfs.value
      ON CREATE SET
        fcfps.value = dfs.value
    )

    FOREACH (dft IN jd.digitalFootprint.topics |
      MERGE
        (fct:FcTopic {value: dft.value})
      MERGE 
        (u)-[:FC_HAS_TOPIC_INTEREST {provider: dft.provider}]->(fct)
    )

    FOREACH (ws IN jd.contactInfo.websites | 
      MERGE 
        (wsu:FcWebsite {url: ws.url})
      MERGE
        (u)-[hw:FC_HAS_WEBSITE]->(wsu)
    ) 

    FOREACH (o IN jd.organizations |
      MERGE 
        (fco:FcOrganization {name: o.name})
      MERGE
        (fcjt:FcJobTitle {name: lower(o.title)})
      MERGE
        (u)-[hr:FC_HAD_ROLE]->(r:FcRole)-[:FC_IN_ORG]->(fco)
      ON CREATE SET
        r.startDate = o.startDate,
        r.endDate = o.endDate,
        r.current = o.current
      ON MATCH SET
        r.current = o.current
      MERGE
        (r)-[:FC_WITH_TITLE]->(fcjit)
    )

    RETURN id(u) AS id, u.email AS email
    """
    results = session.run(instances_query, parameters={"jsonData": jsonData, "email": whIdSegments[1], "id": whIdSegments[0]})

    return results.consume()

def lambda_handler(event, context):
    body = ""
    statusCode = 200
    contentType = 'application/json'

    try:
      postData = urlparse.parse_qs(event['body'])
      logging.error(postData)

      webhookId = postData['webhookId'][0]
      jsonData = postData['result'][0]
      update_fc_info(jsonData, webhookId)
      body = "success"
    except Exception as e:
      logging.error(traceback.format_exc())
      print('Error in processing webhook')

    return { "statusCode": statusCode, "headers": { "Content-type": contentType, "Access-Control-Allow-Origin": "*" }, "body": body }
