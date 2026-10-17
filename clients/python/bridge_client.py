import hashlib
import http.client
import io
import json
import os
import re
import socket
import time
import uuid


class BridgeError(RuntimeError):
    def __init__(self, message, status_code=None, code=None):
        super().__init__(message)
        self.status_code = status_code
        self.code = code


class _PipeHTTPConnection(http.client.HTTPConnection):
    def __init__(self, pipe_path):
        super().__init__("localhost")
        self.pipe_path = pipe_path

    def connect(self):
        try:
            self.sock = _PipeSocket(self.pipe_path)
        except OSError as error:
            raise BridgeError("Could not connect to the VS Code bridge named pipe.") from error


class _PipeSocket:
    def __init__(self, pipe_path):
        self.pipe = open(pipe_path, "r+b", buffering=0)

    def sendall(self, data):
        view = memoryview(data)
        while view:
            written = self.pipe.write(view)
            if not written:
                raise BridgeError("Could not write the bridge request.")
            view = view[written:]

    def makefile(self, mode="rb", buffering=None):
        if mode != "rb":
            raise ValueError("Named-pipe responses must be opened as binary reads.")
        size = io.DEFAULT_BUFFER_SIZE if buffering in (None, -1) else max(1, buffering)
        return io.BufferedReader(_PipeRawReader(self.pipe), buffer_size=size)

    def close(self):
        self.pipe.close()


class _PipeRawReader(io.RawIOBase):
    def __init__(self, pipe):
        super().__init__()
        self.pipe = pipe

    def readable(self):
        return True

    def readinto(self, buffer):
        return self.pipe.readinto(buffer)


class BridgeClient:
    def __init__(self, pipe_name=None, client_id=None, token=None, connection_factory=None):
        self.pipe_name = pipe_name
        self.client_id = client_id or "python-client"
        self.token = token or os.getenv("VSCODE_BROWSER_BRIDGE_TOKEN")
        self.connection_factory = connection_factory or _PipeHTTPConnection

    def _pipe_path(self):
        if self.pipe_name:
            if not re.fullmatch(r"[A-Za-z0-9_-]{1,200}", self.pipe_name):
                raise BridgeError("pipe_name must contain only letters, numbers, underscores, or hyphens.")
            name = self.pipe_name
        else:
            host = socket.gethostname()
            digest = hashlib.sha256(host.encode("utf-8")).hexdigest()[:16]
            name = "vscode-browser-bridge-%s" % digest
        return r"\\.\pipe\%s" % name

    def _request(self, method, path, payload=None, headers=None):
        if not self.token:
            raise BridgeError("Set VSCODE_BROWSER_BRIDGE_TOKEN or pass a token to BridgeClient.")
        request_headers = {
            "Authorization": "Bearer %s" % self.token,
            "X-Bridge-Client": self.client_id,
            "X-Bridge-Nonce": uuid.uuid4().hex,
            "X-Bridge-Timestamp": str(int(time.time() * 1000)),
        }
        if headers:
            request_headers.update(headers)
        body = None
        if payload is not None:
            request_headers["Content-Type"] = "application/json"
            body = json.dumps(payload, separators=(",", ":"))

        connection = self.connection_factory(self._pipe_path())
        try:
            connection.request(method, path, body=body, headers=request_headers)
            response = connection.getresponse()
            raw_body = response.read()
            try:
                result = json.loads(raw_body.decode("utf-8")) if raw_body else {}
            except (UnicodeDecodeError, json.JSONDecodeError) as error:
                raise BridgeError("Bridge returned an invalid JSON response.", response.status, "invalid_response") from error
            if response.status < 200 or response.status >= 300:
                error = result.get("error", {}) if isinstance(result, dict) else {}
                raise BridgeError(
                    error.get("message", "Bridge request failed."),
                    response.status,
                    error.get("code", "request_failed"),
                )
            return result
        finally:
            connection.close()

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
    print("Bridge service:", health.get("service", "unknown"))
    print("Available models:", ", ".join(model.get("id", "") for model in models.get("models", [])))
    print("Reply:", reply.get("response", ""))
