// npx --yes tsx ./dev/generateIndex.ts

import fs from "fs";
import path from "path";

const rootDir = path.resolve(__dirname, "..");
const indexPath = path.join(rootDir, "index.json");

// 1. Delete existing index.json
if (fs.existsSync(indexPath)) {
    fs.unlinkSync(indexPath);
    console.log("Deleted index.json");
}

// 2. Read all *.json files in the root directory (excluding index.json itself)
const jsonFiles = fs
    .readdirSync(rootDir)
    .filter((f) => f.endsWith(".json") && f !== "index.json");

type ServiceEntry = {
    id: string;
    name: string;
    description: string;
    categories: string[];
    serviceUrl: string;
    tags: string[];
};

const services: ServiceEntry[] = jsonFiles.flatMap((file) => {
    const raw = JSON.parse(fs.readFileSync(path.join(rootDir, file), "utf-8"));
    if (raw.ENABLE !== true) return [];
    return [{
        id: raw.id,
        name: raw.name,
        description: raw.description,
        categories: raw.categories,
        serviceUrl: raw.serviceUrl,
        tags: raw.tags,
    }];
});

// 3. Sort by id ascending
services.sort((a, b) => a.id.localeCompare(b.id));

// 4. Write new index.json
fs.writeFileSync(indexPath, JSON.stringify({ services }, null, 2) + "\n", "utf-8");
console.log(`Generated index.json with ${services.length} services (sorted by id).`);
