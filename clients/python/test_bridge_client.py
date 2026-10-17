import json
import hashlib
import socket
import unittest

from bridge_client import BridgeClient, BridgeError


class FakeResponse:
    def __init__(self, status, payload):
        self.status = status
        self.payload = payload

    def read(self):
        return json.dumps(self.payload).encode("utf-8")


class FakeConnection:
    def __init__(self, status=200, payload=None):
        self.status = status
        self.payload = payload or {"ok": True}
        self.request_data = None
        self.closed = False

    def request(self, method, path, body=None, headers=None):
        self.request_data = (method, path, body, headers)

    def getresponse(self):
        return FakeResponse(self.status, self.payload)

    def close(self):
        self.closed = True


class BridgeClientTests(unittest.TestCase):
    def test_health_sends_auth_and_returns_decoded_response(self):
        connection = FakeConnection(payload={"ok": True, "service": "bridge"})
        client = BridgeClient(token="secret-token", connection_factory=lambda _path: connection)

        result = client.health()

        self.assertEqual(result["service"], "bridge")
        method, path, body, headers = connection.request_data
        self.assertEqual((method, path, body), ("GET", "/v1/health", None))
        self.assertEqual(headers["Authorization"], "Bearer secret-token")
        self.assertIn("X-Bridge-Nonce", headers)
        self.assertTrue(connection.closed)

    def test_generate_serializes_json_and_returns_payload(self):
        connection = FakeConnection(payload={"ok": True, "response": "hello"})
        client = BridgeClient(token="secret-token", connection_factory=lambda _path: connection)

        result = client.generate("hello", model="gpt-4o", temperature=0.3)

        method, path, body, headers = connection.request_data
        self.assertEqual((method, path), ("POST", "/v1/generate"))
        self.assertEqual(json.loads(body), {
            "model": "gpt-4o",
            "messages": [{"role": "user", "content": "hello"}],
            "temperature": 0.3,
        })
        self.assertEqual(headers["Content-Type"], "application/json")
        self.assertEqual(result["response"], "hello")

    def test_missing_token_fails_before_connecting(self):
        client = BridgeClient(token="", connection_factory=lambda _path: self.fail("must not connect"))

        with self.assertRaisesRegex(BridgeError, "VSCODE_BROWSER_BRIDGE_TOKEN"):
            client.health()

    def test_custom_pipe_name_is_used_exactly_and_rejects_path_characters(self):
        connection = FakeConnection()
        client = BridgeClient(
            pipe_name="custom_bridge",
            token="secret-token",
            connection_factory=lambda _path: connection,
        )

        client.health()

        self.assertEqual(client._pipe_path(), r"\\.\pipe\custom_bridge")
        invalid = BridgeClient(pipe_name="..\\pipe", token="secret-token")
        with self.assertRaisesRegex(BridgeError, "pipe_name"):
            invalid.health()

    def test_default_pipe_path_matches_extension_hostname_derivation(self):
        client = BridgeClient(token="secret-token")
        digest = hashlib.sha256(socket.gethostname().encode("utf-8")).hexdigest()[:16]

        self.assertEqual(
            client._pipe_path(),
            r"\\.\pipe\vscode-browser-bridge-%s" % digest,
        )

    def test_http_errors_preserve_status_and_error_code(self):
        connection = FakeConnection(status=403, payload={
            "ok": False,
            "error": {"code": "model_request_denied", "message": "denied"},
        })
        client = BridgeClient(token="secret-token", connection_factory=lambda _path: connection)

        with self.assertRaises(BridgeError) as raised:
            client.generate("hello")

        self.assertEqual(raised.exception.status_code, 403)
        self.assertEqual(raised.exception.code, "model_request_denied")
        self.assertTrue(connection.closed)


if __name__ == "__main__":
    unittest.main()
