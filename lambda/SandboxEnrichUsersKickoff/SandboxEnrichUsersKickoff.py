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
from string import Template
import sblambda

db_creds = None

DB_HOST = os.environ["DB_HOST"]
DB_CREDS_BUCKET = os.environ["DB_CREDS_BUCKET"]
DB_CREDS_OBJECT = os.environ["DB_CREDS_OBJECT"]
FC_API_KEY = os.environ["FC_API_KEY"]
FC_PEOPLE_URL = os.environ["FC_PEOPLE_URL"]
FC_PEOPLE_WH_URL = os.environ["FC_PEOPLE_WH_URL"]
MM_USER_ID = os.environ["MM_USER_ID"]
MM_LICENSE_KEY = os.environ["MM_LICENSE_KEY"]



DEFAULT_LOGGING_LEVEL = 0
LOGGING_LEVEL = int(os.environ.get("LOGGING_LEVEL", DEFAULT_LOGGING_LEVEL) )

logger = logging.getLogger()
logger.setLevel(LOGGING_LEVEL)

class MyEncoder(json.JSONEncoder):
    def default(self, obj):
        if isinstance(obj, datetime.datetime):
            return int(time.mktime(obj.timetuple()))

        return json.JSONEncoder.default(self, obj)

def get_users_to_query_auth0():
    session = sblambda.get_db_session()

    instances_query = """
    MATCH 
      (u:User)
    WHERE
      NOT exists(u.sent_to_auth0)
      OR
      u.sent_to_auth0 < (timestamp() - 1000 * 60 * 60 * 24 * 7)
    SET
      u.sent_to_auth0 = timestamp()
    RETURN
      id(u) AS id, u.name AS name, u.email AS email, u.auth0_key AS auth0_key
    """
    results = session.run(instances_query)

    users = []

    for record in results:
      record = dict((el[0], el[1]) for el in record.items())
      users.append(record)

    return users


def get_users_to_query_ip():
    session = sblambda.get_db_session()

    instances_query = """
    MATCH 
      (u:User)
    WHERE
      NOT exists(u.mm_country)
      AND
      ( exists(u.lead_ip) OR exists(u.auth0_last_ip) )
    RETURN
      id(u) AS id, u.name AS name, u.email AS email, u.auth0_key AS auth0_key, coalesce(u.lead_ip,u.auth0_last_ip) AS last_ip
    """
    results = session.run(instances_query)

    users = []

    for record in results:
      record = dict((el[0], el[1]) for el in record.items())
      users.append(record)

    return users

def get_mm_ip_info(lastIp):
    global MM_USER_ID
    global MM_LICENSE_KEY

    ipUrl = 'https://geoip.maxmind.com/geoip/v2.1/city/%s' % (lastIp)

    base64string = base64.b64encode('%s:%s' % (MM_USER_ID, MM_LICENSE_KEY))

    req = urllib2.Request(data = None, url = ipUrl)
    req.add_header("Authorization", "Basic %s" % base64string)

    response = urllib2.urlopen(req)
    responseText = response.read()
    responseJson = json.loads(responseText)
    logger.info(responseJson)
    return responseJson

def updateIpInfo(auth0_key, ipInfo):
    session = sblambda.get_db_session()

    mmCountry = ipInfo['country']['names']['en']
    if mmCountry == 'United States':
        mmState = ipInfo['subdivisions'][0]['names']['en']
    else:
        mmState = ''

    update_query = """
    MATCH
      (u:User)
    WHERE
      u.auth0_key={auth0_key}
    SET
      u.mm_country={mm_country},
      u.mm_state={mm_state}
    """
    session.run(update_query, parameters={"auth0_key": auth0_key, "mm_country": mmCountry, "mm_state": mmState}).consume()

def update_user(id, auth0_key, profile):
    session = sblambda.get_db_session()

    instances_query = """
    UNWIND {profile} AS pro

    MATCH 
      (u:User)
    WHERE
      id(u)={id}
      AND
      u.auth0_key={auth0_key}
    SET
      u.auth0_last_ip = pro.last_ip
    RETURN
      id(u) AS id, u.name AS name, u.email AS email, u.auth0_key AS auth0_key
    """
    results = session.run(instances_query, parameters={"id": id, "profile": profile, "auth0_key": auth0_key})
    users = []

    for record in results:
      record = dict((el[0], el[1]) for el in record.items())
      users.append(record)

    return users

def get_emails_to_send_to_fc():
    session = sblambda.get_db_session()

    instances_query = """
    MATCH 
      (u:User)
    WHERE 
      NOT exists(u.resp_from_fc)
      AND
      (
        NOT exists(u.sent_to_fc)
        OR
        u.sent_to_fc < (timestamp() - 1000 * 60 * 60 * 24 * 7)
      )
    SET
      u.sent_to_fc = timestamp()
    RETURN
      id(u) AS id, u.name AS name, u.email AS email
    """
    results = session.run(instances_query)

    users = []

    for record in results:
      record = dict((el[0], el[1]) for el in record.items())
      users.append(record)

    if session.healthy:
      session.close()

    return users 

def submit_request_to_fc(email, user):
    global FC_API_KEY
    global FC_PEOPLE_URL
    global FC_PEOPLE_WH_URL

    urlParamsDict = {}
    urlParamsDict['email'] = email
    urlParamsDict['webhookUrl'] = FC_PEOPLE_WH_URL
    urlParamsDict['webhookId'] = '%s:%s' % (user['id'],email)
    urlParams = urllib.urlencode(urlParamsDict)
    fullUrl = FC_PEOPLE_URL + '?' + urlParams

    headers = {}
    headers['X-FullContact-APIKey'] = FC_API_KEY

    req = urllib2.Request(fullUrl, None, headers)
    response = urllib2.urlopen(req)
    responseText = response.read()

    return True

def lambda_handler(event, context):
    body = ""
    statusCode = 200
    contentType = 'application/json'
    bodyJson = {
    }

    try:
      users = get_users_to_query_auth0()
      for user in users:
        try:
          profile = sblambda.get_auth0_user_profile(user['auth0_key'])
          update_user(user['id'], user['auth0_key'], profile)
          logger.info(json.dumps(profile))
        except Exception as ex:
          logger.error(traceback.format_exc())
      body = "profile"
    except Exception as e:
      logger.error(traceback.format_exc())
      print('Error in sending requests to FC')



    try:
      users = get_emails_to_send_to_fc()
      testInt = 0
      for user in users:
        if testInt < 2000000:
          try:
            submit_request_to_fc(user['email'], user) 
          except Exception as e:
            logging.error(traceback.format_exc())
            print('Error in sending single request to FC')
        testInt = testInt + 1
      bodyJson['SentEmailsToFc'] = testInt
    except Exception as e:
      logging.error(traceback.format_exc())
      print('Error in sending requests to FC')

    try:
      users = get_users_to_query_ip()
      ipsQueried = 0
      for user in users:
        try:
          ipResults = get_mm_ip_info(user['last_ip'])
          updateIpInfo(user['auth0_key'], ipResults)
          ipsQueried = ipsQueried + 1
        except Exception as ex:
          logger.error(traceback.format_exc())
      bodyJson['ipAddressesQueriedGeo'] = ipsQueried
    except Exception as e:
      logger.error(traceback.format_exc())
      print('Error in sending requests to IP geo deduction')
      
    return { "statusCode": statusCode, "headers": { "Content-type": contentType, "Access-Control-Allow-Origin": "*" }, "body": json.dumps(bodyJson) }
