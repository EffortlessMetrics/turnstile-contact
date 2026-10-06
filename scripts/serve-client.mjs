import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";
const root = resolve(process.env.CONTACT_CONSUMER_ROOT ?? ".qualification/packed-consumer");
createServer(async (req, res) => {
  const file = resolve(
    root,
    "." + new URL(req.url, "http://localhost").pathname.replace(/\/$/, "/index.html"),
  );
  if (!file.startsWith(root + sep)) {
    res.writeHead(403).end();
    return;
  }
  try {
    const body = await readFile(file);
    res.setHeader("Content-Type", extname(file) === ".js" ? "text/javascript" : "text/html");
    res.end(body);
  } catch {
    res.writeHead(404).end();
  }
}).listen(3478, "127.0.0.1");
