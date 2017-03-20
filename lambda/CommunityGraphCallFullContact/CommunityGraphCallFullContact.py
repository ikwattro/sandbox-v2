from __future__ import print_function
import json
import boto3
import datetime
import time
import base64
import os
from random_words import RandomWords
from neo4j.v1 import GraphDatabase, basic_auth
import random
import sys
import hashlib
import logging
import urllib2

db_creds = None

DB_HOST = os.environ["DB_HOST"]
DB_USER = os.environ["DB_USER"]
DB_PW = os.environ["DB_PW"]

logger = logging.getLogger()
logger.setLevel(LOGGING_LEVEL)

driver = GraphDatabase.driver("bolt://%s" % (DB_HOST), auth=basic_auth(DB_USER, DB_PW), encrypted=False)

class MyEncoder(json.JSONEncoder):
    def default(self, obj):
        if isinstance(obj, datetime.datetime):
            return int(time.mktime(obj.timetuple()))

        return json.JSONEncoder.default(self, obj)

def get_db_session():
    global driver
    session = driver.session()
    return session

def get_users_fc():
    result = False

    session = get_db_session()
    
    query = """
    MATCH 
      (u:User)-[:IS_ALLOCATED]-(s:Sandbox)
    WHERE 
      u.auth0_key = {auth0_key}
      AND
      s.running=True
      AND
      s.usecase={usecase}
    RETURN
      u.auth0_key
    """
    results = session.run(query, 
      parameters={"auth0_key": user, "usecase": usecase})
    for record in results:
        result = True
    if session.healthy:
        session.close()

    return result

def user_verified(user):
    result = False

    session = get_db_session()
    
    query = """
    MATCH 
      (u:User)
    WHERE 
      u.auth0_key = {auth0_key}
      AND
      u.email_verified = true
    RETURN
      u.auth0_key
    """
    results = session.run(query, 
      parameters={"auth0_key": user})
    for record in results:
        result = True
    if session.healthy:
        session.close()

    return result

def add_sandbox_to_db(user, usecase, taskid, password, sandboxHashKey):
    session = get_db_session()
    
    query = """
    MATCH (uc:Usecase {name: {usecase}})
    MERGE
      (u:User {auth0_key: {auth0_key}})
    CREATE (u)-[:IS_ALLOCATED]->(s:Sandbox)
    SET
      s.running=True,
      s.usecase={usecase},
      s.taskid={taskid},
      s.password={password},
      s.sandbox_hash_key={sandboxHashKey},
      s.expires=(timestamp() + 1000 * 60 * 60 * 24 * 3),
      s.sendEmailCreated='Q',
      s.createdAt=timestamp()
    CREATE (s)-[:IS_INSTANCE_OF]->(uc)
    RETURN s.sandbox_hash_key AS sandboxHashKey,s.taskid AS taskId,s.usecase AS usecase,s.running AS running,s.expires AS expires,uc.model_image AS modelImage
    """
    results = session.run(query,
      parameters={"auth0_key": user, "usecase": usecase, "taskid": taskid, "password": password, "sandboxHashKey": sandboxHashKey})

    if session.healthy:
        session.close()

    return results
    
def lambda_handler(event, context):
    global SANDBOX_TASK_DEFINITION, SANDBOX_CLUSTER_NAME, LOGGING_LEVEL, SANDBOX_TWITTER_TASK_DEFINITION
    
    
    logger.debug('Starting lambda_handler')
    
    event_json = json.loads(event["body"])
    usecase = event_json["usecase"]
    user = event['requestContext']['authorizer']['principalId']
    
    logger.debug('Checking to see if sandbox exists')

    if not user_verified(user):
        logger.error('User email is not verified for user: %s' % (user))

        response_statusCode = 403
        response_contentType = 'application/json'
        response_body = json.dumps( {"errorString": "User email is not verified for user: %s"  % (user) })

        return { "statusCode": response_statusCode, "headers": { "Content-type": response_contentType, "Access-Control-Allow-Origin": "*" }, "body": response_body }
         
    elif not check_sandbox_exists(user, usecase):
        logger.debug('Generating password')

        userDbPassword = get_generated_password()
        
        logger.debug('Generating hashkey')

        # note: this isn't meant to generate a secure random number,
        # just a key used for later lookup
        randomNumber = random.SystemRandom().randint(0, sys.maxint)
        md5 = hashlib.md5()
        md5.update("%s-%s" % (userDbPassword, randomNumber))
        sandboxHashKey = md5.hexdigest()

        logger.debug('Running Task on ECS')
        client = boto3.client('ecs')
 
        # TODO need to catch exceptions such as
        # An error occurred (InvalidParameterException) when calling the 
        # RunTask operation: No Container Instances were found in your 
        # cluster.: InvalidParameterException

        if usecase == 'twitter' and user[0:8] == 'twitter|':
          twitterUserCreds = get_twitter_user_creds(user)
          twitterAppCreds = get_twitter_app_creds()
          response = client.run_task(
              cluster=SANDBOX_CLUSTER_NAME,
              taskDefinition=SANDBOX_TWITTER_TASK_DEFINITION,
              overrides={"containerOverrides": [{
                  "name": "neo4j-enterprise-db-only",
                  "environment":
                      [
                          { "name": "USECASE",
                            "value": usecase},
                          { "name": "EXTENSION_SCRIPT",
                            "value": "extension/extension_script.sh"},
                          { "name": "SANDBOX_USER",
                            "value": user},
                          { "name": "NEO4J_AUTH",
                            "value": "neo4j/%s" % (userDbPassword)},
                          { "name": "SANDBOX_HASHKEY",
                            "value": "%s" % (sandboxHashKey)}
                      ]
              },
              {
                  "name": "neo4j-twitter",
                  "environment":
                      [
                          { "name": "TWITTER_CONSUMER_KEY",
                            "value": twitterAppCreds['consumer_key']},
                          { "name": "TWITTER_CONSUMER_SECRET",
                            "value": twitterAppCreds['consumer_secret']},
                          { "name": "TWITTER_USER_KEY",
                            "value": twitterUserCreds['access_token']},
                          { "name": "TWITTER_USER_SECRET",
                            "value": twitterUserCreds['access_token_secret']},
                          { "name": "NEO4J_AUTH",
                            "value": "neo4j/%s" % (userDbPassword)}
                      ]
              }
              ]},
              placementStrategy=[ {"type": "spread", "field": "instanceId"} ],
              startedBy=('SB("%s","%s")' % (user, usecase))[:36]
          )
        else:
          response = client.run_task(
              cluster=SANDBOX_CLUSTER_NAME,
              taskDefinition=SANDBOX_TASK_DEFINITION,
              overrides={"containerOverrides": [{
                  "name": "neo4j-enterprise-db-only",
                  "environment":
                      [
                          { "name": "USECASE",
                            "value": usecase},
                          { "name": "EXTENSION_SCRIPT",
                            "value": "extension/extension_script.sh"},
                          { "name": "SANDBOX_USER",
                            "value": user},
                          { "name": "NEO4J_AUTH",
                            "value": "neo4j/%s" % (userDbPassword)},
                          { "name": "SANDBOX_HASHKEY",
                            "value": "%s" % (sandboxHashKey)}
                      ]
              },
              {
                  "name": "neo4j-importer",
                  "environment":
                      [
                          { "name": "USECASE",
                            "value": usecase},
                          { "name": "NEO4J_AUTH",
                            "value": "neo4j/%s" % (userDbPassword)}
                      ]
              }
              ]},
              placementStrategy=[ {"type": "spread", "field": "instanceId"} ],
              startedBy=('SB("%s","%s")' % (user, usecase))[:36]
          )
        logger.debug('Adding sandbox to database')
        if 'tasks' in response and len(response['tasks']) > 0:
          res = add_sandbox_to_db(user, usecase, response['tasks'][0]['taskArn'], encrypt_user_creds(userDbPassword), sandboxHashKey)
          response_json = { "status": "PENDING", "password": userDbPassword}
          for record in res:
              record_dict = dict(record)
          response_json.update(record_dict)    
          response_statusCode = 200
        else: 
          response_json = { "status": "FAILED",
                            "ECS response": response }
          response_statusCode = 500

        response_body = json.dumps(response_json, indent=2, cls=MyEncoder )
        # response_body = json.dumps(response['tasks'][0], indent=2, cls=MyEncoder)
        response_contentType = 'application/json'
    
        return { "statusCode": response_statusCode, "headers": { "Content-type": response_contentType, "Access-Control-Allow-Origin": "*" }, "body": response_body }
        
    else:
        logger.error('Sandbox already exists for user: %s and usecase %s' % (user, usecase))

        response_statusCode = 400
        response_contentType = 'application/json'
        response_body = json.dumps( {"errorString": "Sandbox already exists for user: %s and usecase %s"  % (user, usecase) })

        return { "statusCode": response_statusCode, "headers": { "Content-type": response_contentType, "Access-Control-Allow-Origin": "*" }, "body": response_body }
