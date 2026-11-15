const ENDPOINT = "REPLACE_WITH_DESKTOP_ENDPOINT";
let status = "skipped";

try {
  const input = args.shortcutParameter;
  const text = value => typeof value === "string" ? value.trim() : "";
  const payload = typeof input === "string"
    ? { message: text(input) }
    : { message: text(input && input.message), appId: text(input && input.appId), appName: text(input && input.appName) };

  if (payload.message) {
    const request = new Request(ENDPOINT);
    request.method = "POST";
    request.headers = { "Content-Type": "application/json" };
    request.body = JSON.stringify(payload);
    request.timeoutInterval = 2;

    const reply = await request.loadJSON();
    const code = request.response ? request.response.statusCode : 0;
    if (code >= 200 && code < 300 && reply && reply.ok === true) {
      status = "sent";
    }
  }
} catch (_) {
  status = "skipped";
}

Script.setShortcutOutput(status);
Script.complete();
