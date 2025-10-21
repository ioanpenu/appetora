import { StorageSharedKeyCredential, generateBlobSASQueryParameters, BlobSASPermissions } from "@azure/storage-blob";
import { verify } from "../shared/jwt.js";

export default async function (context, req) {
  try {
    // auth
    const cookie = (req.headers && req.headers.cookie) || "";
    const m = /appetora_token=([^;]+)/.exec(cookie);
    if (!m) return respond(context, 401, { error: "No session" });
    const me = verify(m[1]);
    if (!me) return respond(context, 401, { error: "Invalid session" });

    const url = new URL(req.url, "http://x");
    const blobPath = url.searchParams.get("blob");
    if (!blobPath) return respond(context, 400, { error: "blob required" });

    // protecție simplă: blob-ul trebuie să fie în folderul userului
    if (!blobPath.startsWith(`${me.uid}/`)) {
      return respond(context, 403, { error: "Forbidden" });
    }

    const conn = process.env.BLOB_CONN_STRING;
    const containerName = process.env.BLOB_CONTAINER || "images";
    const match = /AccountName=([^;]+);.*AccountKey=([^;]+)/.exec(conn);
    if (!match) return respond(context, 500, { error: "Invalid storage connection string" });

    const accountName = match[1];
    const accountKey = match[2];
    const sharedCred = new StorageSharedKeyCredential(accountName, accountKey);

    const expiresOn = new Date(Date.now() + 60 * 60 * 1000); // 1 oră read
    const sas = generateBlobSASQueryParameters(
      {
        containerName,
        blobName: blobPath,
        permissions: BlobSASPermissions.parse("r"),
        startsOn: new Date(Date.now() - 60 * 1000),
        expiresOn
      },
      sharedCred
    ).toString();

    const publicUrl = `https://${accountName}.blob.core.windows.net/${containerName}/${blobPath}?${sas}`;
    return respond(context, 200, { url: publicUrl });
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
