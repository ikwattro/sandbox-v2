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

db_creds = None

DB_HOST = os.environ["DB_HOST"]
DB_CREDS_BUCKET = os.environ["DB_CREDS_BUCKET"]
DB_CREDS_OBJECT = os.environ["DB_CREDS_OBJECT"]
FC_API_KEY = os.environ["FC_API_KEY"]
FC_PEOPLE_URL = os.environ["FC_PEOPLE_URL"]
FC_PEOPLE_WH_URL = os.environ["FC_PEOPLE_WH_URL"]


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

def get_emails_to_send_to_fc():
    session = get_db_session()

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
      body = "Handled %d emails" % (testInt)
    except Exception as e:
      logging.error(traceback.format_exc())
      print('Error in sending requests to FC')

    return { "statusCode": statusCode, "headers": { "Content-type": contentType, "Access-Control-Allow-Origin": "*" }, "body": body }
