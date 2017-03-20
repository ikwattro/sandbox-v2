from __future__ import print_function
import json
from neo4j.v1 import GraphDatabase, basic_auth, constants
import boto3
import datetime
import time
import os
import sblambda
import urllib2
import logging

LOGGING_LEVEL = int(os.environ.get("LOGGING_LEVEL", 0))

logger = logging.getLogger()
logger.setLevel(LOGGING_LEVEL)


def check_new_user(user, userIp, marketoCookie, utmSource):
    session = sblambda.get_db_session()
    user_query = """
    MATCH (u:User {auth0_key:{user}})
    WHERE 
      NOT EXISTS(u.lead_status)
    AND
      (timestamp() - (1000 * 60 * 1)) < u.createdAt
    SET
      u.lead_status='NEW',
      u.lead_ip={userIp},
      u.mm_cookie={marketoCookie},
      u.utm_source={utmSource}
    RETURN
      u.email AS email,
      u.lead_status AS lead_status
    """
    results = session.run(user_query, parameters={"user": user, "userIp": userIp, "marketoCookie": marketoCookie, "utmSource": utmSource})
    for record in results:
        return record['lead_status'] 
    return False



def lambda_handler(event, context):
    global logger

    bodyPosted = json.loads(event["body"])
    user = event['requestContext']['authorizer']['principalId']
    userIp = event['requestContext']['identity']['sourceIp']

    if 'marketoCookie' in bodyPosted:
      marketoCookie = bodyPosted['marketoCookie']
    else:
      marketoCookie = None
    if 'utmSource' in bodyPosted:
      utmSource = bodyPosted['utmSource']
    else:
      utmSource = None

    leadStatus = check_new_user(user, userIp, marketoCookie, utmSource)
    responseStatus = {'lead_status': 'UNK'} 
    if leadStatus:
      responseStatus = {'lead_status': leadStatus}


    bodyObj = {}
    contentType = 'text/javascript'

    logger.info('Returning Lead Status %s for user %s' % (json.dumps(responseStatus), user))

    statusCode = 200
    bodyObj = responseStatus
 
    return { "statusCode": statusCode, "headers": { "Content-type": contentType, "Access-Control-Allow-Origin": "*" }, "body": json.dumps(bodyObj) }

