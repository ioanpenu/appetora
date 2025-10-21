import { BlobServiceClient, StorageSharedKeyCredential, generateBlobSASQueryParameters, BlobSASPermissions } from "@azure/storage-blob";
import { verify } from "../shared/jwt.js";

export default async function (context, req) {
  try {
    // auth din cookie
    const cookie = (req.headers && req.headers.cookie) || "";
    const m = /appetora_token=([^;]+)/.exec(cookie);
    if (!m) return respond(context, 401, { error: "No session" });
    const me = verify(m[1]);
    if (!me) return respond(context, 401, { error: "Invalid session" });

    const body = await readBody(req);
    const filename = String(body.filename || "").replace(/[^a-zA-Z0-9._-]/g, "");
    const contentType = String(body.contentType || "application/octet-stream");

    if (!filename) return respond(context, 400, { error: "filename required" });

    // ENV
    const conn = process.env.BLOB_CONN_STRING;
    const containerName = process.env.BLOB_CONTAINER || "images";
    if (!conn) return respond(context, 500, { error: "Storage missing config" });

    // derivăm credențialele (din connection string)
    const match = /AccountName=([^;]+);.*AccountKey=([^;]+)/.exec(conn);
    if (!match) return respond(context, 500, { error: "Invalid storage connection string" });
    const accountName = match[1];
    const accountKey = match[2];

    const sharedCred = new StorageSharedKeyCredential(accountName, accountKey);
    const service = BlobServiceClient.fromConnectionString(conn);
    const container = service.getContainerClient(containerName);

    // folder per user
    const blobPath = `${me.uid}/${Date.now()}_${filename}`;
    const blobClient = container.getBlockBlobClient(blobPath);

    // SAS write 10 minute
    const expiresOn = new Date(Date.now() + 10 * 60 * 1000);
    const sas = generateBlobSASQueryParameters(
      {
        containerName,
        blobName: blobPath,
        permissions: BlobSASPermissions.parse("cw"), // create + write
        startsOn: new Date(Date.now() - 60 * 1000),
        expiresOn
      },
      sharedCred
    ).toString();

    const uploadUrl = `${blobClient.url}?${sas}`;

    return respond(context, 200, {
      uploadUrl,
      blobPath,
      contentType
    });
  } catch (e) {
    context.log.error(e);
    return respond(context, 500, { error: e.message });
  }
}

function respond(context, status, obj) {
  context.res = {
    status,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(obj)
  };
}
async function readBody(req) {
  if (!req.body) return {};
  return typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body;
}
