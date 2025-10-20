
import { CosmosClient } from "@azure/cosmos";
const client = new CosmosClient(process.env.COSMOS_CONN_STRING);
const db = client.database(process.env.COSMOS_DB);
export const colUsers = db.container(process.env.COSMOS_COL_USERS || "users");
export const colUsage = db.container(process.env.COSMOS_COL_USAGE || "usage");
export const colRecipes = db.container(process.env.COSMOS_COL_RECIPES || "recipes");
export const colHistory = db.container(process.env.COSMOS_COL_HISTORY || "history");
