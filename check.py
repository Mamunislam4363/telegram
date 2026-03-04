import urllib.request, json

print("=== BOT FULL CHECK ===")

# POST register test
data = json.dumps({"userId": 999, "firstName": "Test", "username": "test"}).encode()
req = urllib.request.Request(
    "http://localhost:3000/api/register",
    data=data,
    headers={"Content-Type": "application/json"},
    method="POST"
)
try:
    r = urllib.request.urlopen(req, timeout=5)
    d = json.loads(r.read())
    print("OK  POST /api/register -> success=" + str(d.get("success")) + " tokens=" + str(d.get("tokens")))
except Exception as e:
    print("FAIL POST /api/register: " + str(e))

tests = [
    ("http://localhost:3000/", "GET  Web App HTML"),
    ("http://localhost:3000/admin.html", "GET  Admin Panel"),
    ("http://localhost:3000/api/admin/stats", "GET  /api/admin/stats"),
    ("http://localhost:3000/api/ads/config", "GET  /api/ads/config"),
    ("http://localhost:3000/api/admin/ads", "GET  /api/admin/ads"),
    ("http://localhost:3000/api/admin/codes", "GET  /api/admin/codes"),
    ("http://localhost:3000/api/admin/services", "GET  /api/admin/services"),
    ("http://localhost:3000/api/admin/shop", "GET  /api/admin/shop"),
    ("http://localhost:3000/api/leaderboard?userId=999", "GET  /api/leaderboard"),
    ("http://localhost:3000/api/user/999", "GET  /api/user/:id"),
    ("http://localhost:3000/api/admin/email-services", "GET  /api/admin/email-services"),
    ("http://localhost:3000/api/admin/tasks", "GET  /api/admin/tasks"),
    ("http://localhost:3000/api/history/999", "GET  /api/history/:id"),
    ("http://localhost:3000/api/accounts", "GET  /api/accounts"),
]

for url, name in tests:
    try:
        r = urllib.request.urlopen(url, timeout=5)
        code = r.getcode()
        print("OK  [" + str(code) + "] " + name)
    except urllib.error.HTTPError as e:
        print("ERR [" + str(e.code) + "] " + name + ": " + str(e.reason))
    except Exception as e:
        print("FAIL " + name + ": " + str(e))

print("=== DONE ===")
