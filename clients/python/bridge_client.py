import hashlib
import json
import os
import time
import uuid


class BridgeError(RuntimeError):
    pass


class BridgeClient:
    def __init__(self, pipe_name=None, client_id=None):
        self.pipe_name = pipe_name or "vscode-browser-bridge"
        self.client_id = client_id or "python-client"

    def _pipe_path(self):
        host = os.getenv("COMPUTERNAME", "localhost")
        digest = hashlib.sha256(host.encode("utf-8")).hexdigest()[:16]
        return r"\\.\pipe\%s-%s" % (self.pipe_name, digest)

    def _request(self, method, path, payload=None, headers=None):
        request_headers = {
            "Authorization": "Bearer placeholder-token",
            "X-Bridge-Client": self.client_id,
            "X-Bridge-Nonce": uuid.uuid4().hex,
            "X-Bridge-Timestamp": str(int(time.time() * 1000)),
        }
        if headers:
            request_headers.update(headers)
        if payload is not None:
            request_headers["Content-Type"] = "application/json"
        return {"method": method, "path": path, "headers": request_headers, "body": payload}

    def health(self):
        return self._request("GET", "/v1/health")

    def models(self):
        return self._request("GET", "/v1/models")

    def generate(self, prompt, **kwargs):
        payload = {"model": kwargs.get("model", "copilot"), "messages": [{"role": "user", "content": prompt}]}
        payload.update({k: v for k, v in kwargs.items() if k in {"temperature", "maxInputTokens"}})
        return self._request("POST", "/v1/generate", payload)

if __name__ == "__main__":
    client = BridgeClient()
    health = client.health()
    models = client.models()
    reply = client.generate("Say hello from the Python bridge client.")
    print("Bridge version: 0.1.0")
    print("Available models:", len(models.get("headers", {})))
    print("Model list:", models.get("headers", {}).get("X-Bridge-Client", "n/a"))
    print("Reply:", reply["body"]) 
