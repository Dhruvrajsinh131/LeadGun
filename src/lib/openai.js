"use strict";

const { OpenAI } = require("openai");

const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
let client = null;

function apiKey() {
  return (process.env.OPENAI_API_KEY || "").trim();
}

function getOpenAI() {
  if (!client) client = new OpenAI({ apiKey: apiKey() });
  return client;
}

function hasOpenAI() {
  return Boolean(apiKey());
}

module.exports = { getOpenAI, hasOpenAI, model };
