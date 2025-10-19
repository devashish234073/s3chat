const express = require("express");
const bodyParser = require("body-parser");
const AWS = require("aws-sdk");
const path = require("path");
const fs = require("fs");

const app = express();
let port = 3000;
if(process.argv[3]) {
    port = parseInt(process.argv[3]);
}
const username = process.argv[2];

if (!username) {
  console.error("❌ Usage: node app.js <username>");
  process.exit(1);
}

const s3 = new AWS.S3({ region: "us-east-1" });

// Express setup
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static("public"));
app.set("view engine", "html");

// Check permission on start
(async () => {
  try {
    await s3.listObjectsV2({ Bucket: username, MaxKeys: 1 }).promise();
    console.log(`✅ Connected to bucket: ${username}`);
  } catch (err) {
    console.error(`❌ Cannot access bucket "${username}". Check IAM or bucket policy.`);
    process.exit(1);
  }
})();

// Fetch messages
async function loadReceivedMessages() {
  try {
    const list = await s3.listObjectsV2({
      Bucket: username,
      Prefix: "received-messages/",
    }).promise();

    if (!list.Contents || list.Contents.length === 0) return [];

    const messages = [];
    for (const obj of list.Contents) {
      const data = await s3.getObject({
        Bucket: username,
        Key: obj.Key,
      }).promise();

      messages.push({
        file: path.basename(obj.Key),
        content: data.Body.toString("utf-8"),
      });
    }
    return messages;
  } catch (err) {
    console.error("❌ Error loading messages:", err.message);
    return [];
  }
}

// Routes
app.get("/", async (req, res) => {
  const receivedMessages = await loadReceivedMessages();
  let html = fs.readFileSync(path.join(__dirname, "public", "chat.html"), "utf-8");
  html = html.replace("{{username}}", username);
  html = html.replace("{{messages}}", JSON.stringify(receivedMessages));
  res.send(html);
});

app.post("/send", async (req, res) => {
  const { receiverBucket, message } = req.body;
  if (!receiverBucket || !message) {
    return res.status(400).send("Receiver bucket and message are required");
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const recvKey = `received-messages/${username}_${timestamp}.txt`;
  const sentKey = `sent-messages/${receiverBucket}_${timestamp}.txt`;

  try {
    // Upload to receiver's received-messages
    await s3.putObject({
      Bucket: receiverBucket,
      Key: recvKey,
      Body: message,
      ContentType: "text/plain",
    }).promise();

    // Upload to sender's sent-messages
    await s3.putObject({
      Bucket: username,
      Key: sentKey,
      Body: message,
      ContentType: "text/plain",
    }).promise();

    res.send(`✅ Sent to ${receiverBucket} and saved locally`);
  } catch (err) {
    console.error("❌ Upload failed:", err.message);
    res.status(500).send(`❌ Upload failed: ${err.message}`);
  }
});

app.listen(port, () => {
  console.log(`💬 Chat for ${username} running on http://localhost:${port}`);
});
