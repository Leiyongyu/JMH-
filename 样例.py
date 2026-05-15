import base64
import hashlib
import json
import logging
import os
import time
from urllib.parse import urlencode, urljoin

import orjson
import requests
from Crypto.Cipher import AES

# 配置参数
APP_ID = os.getenv("LINGXING_APP_ID")
APP_SECRET = os.getenv("LINGXING_APP_SECRET")
TOKEN_URL = "https://openapi.lingxing.com/api/auth-server/oauth/access-token"
QUERY_URL = "https://openapi.lingxing.com/erp/sc/data/account/lists"
TIME_OUT = 60
LOG_LEVEL = logging.DEBUG
LENGTH = 500
FILE_PATH = r"D:\projects\python\lingxing\json_data\user.json"
RETRY_TIMES = 30
START_DATE = "2025-11-01"
END_DATE = "2025-12-01"


class ConfigError(Exception):
    pass


def validate_config():
    if not APP_ID or not APP_SECRET:
        
        raise ConfigError(
            "缺少必要的配置信息。请设置环境变量：\n"
            "export LINGXING_APP_ID='your_app_id'\n"
            "export LINGXING_APP_SECRET='your_app_secret'"
        )

# Bytes
BLOCK_SIZE = 16


class Purchaser:
    def __init__(self):
        self.access_token = None
        self.refresh_token = None
        # Token过期时间（时间戳）
        self.token_expire_time = 0

    def get_access_token(self):
        # 发送请求获取Token
        data = {
            "appId": APP_ID,
            "appSecret": APP_SECRET
        }
        try:
            response = requests.post(TOKEN_URL, data=data, timeout=TIME_OUT)
            result = response.json()
            # 成功码为200
            if result.get("code") == "200":
                self.access_token = result["data"]["access_token"]
                self.token_expire_time = time.time() + result["data"]["expires_in"]
                self.refresh_token = result["data"]["refresh_token"]
                logging.info(f"获取Token成功，有效期至：{time.ctime(self.token_expire_time)}")
                time.sleep(0.1)
                return self.access_token
            else:
                logging.error(result)
                raise Exception("获取Token失败")
        except Exception as error:
            logging.error(f"获取Token请求异常：{str(error)}")
            raise error

    def generate_sign(self, query):
        canonical_querystring = self.format_params(query)
        md5_str = self.md5_encrypt(canonical_querystring).upper()
        sign_str = self.aes_encrypt(APP_ID, md5_str)
        return sign_str

    def do_pad(self, text):
        return text + (BLOCK_SIZE - len(text) % BLOCK_SIZE) * \
            chr(BLOCK_SIZE - len(text) % BLOCK_SIZE)

    def md5_encrypt(self, text: str):
        md = hashlib.md5()
        md.update(text.encode('utf-8'))
        return md.hexdigest()

    def aes_encrypt(self, key, data):
        """
        AES的ECB模式加密方法
        :param key: 密钥
        :param data:被加密字符串（明文）
        :return:密文
        """
        key = key.encode('utf-8')
        # 字符串补位
        data = self.do_pad(data)
        cipher = AES.new(key, AES.MODE_ECB)
        # 加密后得到的是bytes类型的数据，使用Base64进行编码,返回byte字符串
        enc = cipher.encrypt(data.encode())
        encode_str = base64.b64encode(enc)
        enc_text = encode_str.decode('utf-8')
        return enc_text

    def format_params(self, request_params):
        """
        格式化 params
        """
        if not request_params or not isinstance(request_params, dict):
            return ''

        canonical_strs = []
        sort_keys = sorted(request_params.keys())
        for k in sort_keys:
            v = request_params[k]
            if v == "":
                continue
            elif isinstance(v, (dict, list)):
                # 如果直接使用 json, 则必须使用separators=(',',':'), 去除序列化后的空格, 否则 json中带空格就导致签名异常
                # 使用 option=orjson.OPT_SORT_KEYS 保证dict进行有序 序列化(因为最终要转换为 str进行签名计算, 需要保证有序)
                canonical_strs.append(f"{k}={orjson.dumps(v, option=orjson.OPT_SORT_KEYS).decode()}")
            else:
                canonical_strs.append(f"{k}={v}")
        return "&".join(canonical_strs)


if __name__ == "__main__":
    # log配置
    logging.basicConfig(
        level=logging.DEBUG,
        # 格式：时间 - 级别 - 消息
        format="%(asctime)s - %(levelname)s - %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
        handlers=[
            # 输出到文件（app.log）
            # logging.FileHandler("app.log"),
            # 同时输出到控制台
            logging.StreamHandler()
        ]
    )
    
    # 验证配置
    validate_config()
    
    app = Purchaser()
    token = app.get_access_token()
    if not token:
        logging.error("获取token为空")
        raise Exception("获取token为空")
    else:
        result_json_data = []
        # 构造请求参数
        timestamp = f'{int(time.time())}'
        params = {
            "app_key": APP_ID,
            "timestamp": timestamp,
            "access_token": token
        }
        # 生成签名
        sign = app.generate_sign(params)
        params["sign"] = sign
        query_string = urlencode(params)
        logging.debug(params)
        # 发送请求
        headers = {
            "Content-Type": "application/json"
        }
        try:
            response = requests.get(
                urljoin(QUERY_URL, f"?{query_string}"),
                headers=headers,
                timeout=TIME_OUT
            )
        except Exception as e:
            logging.error(f"请求异常：{str(e)}")
            raise e
        result = response.json()
        logging.debug(result)
        if result.get("code") == 0:
            result_json_data.extend(result["data"])
        else:
            logging.error(result)
            raise Exception("获取数据失败")
        # 写入数据
        with open(FILE_PATH, "w", encoding="utf-8") as f:
            for item in result_json_data:
                # 将每个对象转换为 JSON 字符串并写入
                json_line = json.dumps(item, ensure_ascii=False)
                f.write(json_line + '\n')
