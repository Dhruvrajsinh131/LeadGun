"use strict";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const random = (min, max) => Math.random() * (max - min) + min;

module.exports = { sleep, random };
