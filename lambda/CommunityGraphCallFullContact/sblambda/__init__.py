import boto3
import json
import os
import base64
from neo4j.v1 import GraphDatabase, basic_auth, constants

creds = {}
glob_session = None
DB_HOST = os.environ["DB_HOST"]
DB_CREDS_BUCKET = os.environ["DB_CREDS_BUCKET"]

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


def get_creds(credName):
    global creds, DB_CREDS_BUCKET

    if credName in creds:
        return creds[credName]
    else:
        s3 = boto3.client('s3')
        kms = boto3.client('kms')
        response = s3.get_object(Bucket=DB_CREDS_BUCKET,Key="%s.enc.cfg" % (credName))
        contents = response['Body'].read()

        encryptedData = decode_base64(contents)
        decryptedResponse = kms.decrypt(CiphertextBlob = encryptedData)
        decryptedData = decryptedResponse['Plaintext']
        creds[credName] = json.loads(decryptedData)
        return creds[credName]


def get_db_creds():
    return get_creds('neo4j')


def get_db_session():
    global glob_session

    if glob_session and glob_session.healthy:
        session = glob_session
    else:
        creds = get_db_creds()
        driver = GraphDatabase.driver("bolt://%s" % (DB_HOST), auth=basic_auth(creds['user'], creds['password']), encrypted=False)
        session = driver.session()
        glob_session = session
    return session

def decrypt_user_creds(encryptedPassword):
    kms = boto3.client('kms')
    binaryPassword = base64.b64decode(encryptedPassword)
    return (kms.decrypt(CiphertextBlob=binaryPassword))['Plaintext']
