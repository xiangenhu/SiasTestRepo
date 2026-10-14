const { defineConfig } = require('@playwright/test');
module.exports = defineConfig({testDir:'./e2e',use:{baseURL:'http://127.0.0.1:3107'},webServer:{command:'PORT=3107 node server.js',url:'http://127.0.0.1:3107',reuseExistingServer:false},reporter:'list'});
