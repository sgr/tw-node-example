/*jslint node: true, bitwise: true */
'use strict';
require('console-stamp')(console, {pattern: "yyyy-mm-dd HH:MM:ss.l"});
const dateformat = require('dateformat');
const yaml = require('js-yaml');
const fs = require('fs');
const Promise = require('bluebird');
const raspi = Promise.promisifyAll(require('raspi'));
const I2C = require('raspi-i2c').I2C;
const BME280 = require('./bme280.js');
Promise.promisifyAll(BME280.prototype);

// Thingworx
const Api = require('thingworx-api').Api;
const Thing = require('thingworx-api').Thing;
const logger = require('thingworx-utils').Logger;

var config;
var bme280;
var bme280thing;

var api;

var INTERVAL_MSEC = 1000; // config.yml で上書きできる

const twConnect = () => {
    api.connect(() => {  // Establish a connection to thingworx
        if (!api.isConnected()) {
            console.log('WILL RETRY CONNECTING AFTER 60 SECONDS');
            Promise.delay(60 * 1000).then(() => {
                console.log('RETRY CONNECTING...');
                twConnect();
            });
        }
    });
};

const shutdown = sig => {
    console.log("CAUGHT %s, SHUTTING DOWN...", sig);
    Promise.resolve(0)
        .then(() => {
            if (config && config.enableThingworx) {
                api.disconnect(err => {
                    if (err) {
                        console.warn("FAILED TO DISCONNECTED THINGWORX " + err);
                        process.exit(1);
                    } else {
                        console.log("DISCONNECTED THINGWORX SUCCESSFULLY");
                        process.exit(0);
                    }
                });
            } else {
                process.exit(0);
            }
        });
};

const twConnected = () => {
    console.log("CONNECTED WITH A THINGWORX SERVER");
};

const twDisconnected = msg => {
    console.log('DISCONNECTED: %s, %s', msg, api.isConnected());
    Promise.delay(5 * 1000).then(() => {
        console.log('RETRY CONNECTING...');
        // 旧apiオブジェクトはGCされるようで、作りなおさないとメモリエラーになる
        api = new Api(config.thingworxSettings);
        api.on('connect', twConnected);
        api.on('disconnect', twDisconnected);
        twConnect();
    });
};

// main
Promise.resolve(0)
    .then(() => { // 初期化
        process.env.TZ = 'Asia/Tokyo';
        process.on('SIGINT', () => shutdown('SIGINT'));
        process.on('SIGTERM', () => shutdown('SIGTERM'));

        config = yaml.safeLoad(fs.readFileSync('./conf/config.yml'));
        console.log('READ CONFIG: %j', config);
        INTERVAL_MSEC = 'interval_msec' in config ? config.interval_msec : INTERVAL_MSEC;

        if (config && config.enableThingworx) {
            api = new Api(config.thingworxSettings);
            api.on('connect', twConnected);
            api.on('disconnect', twDisconnected);
        }

        // 設定ファイルから読み込んだセンサータグ情報から ThingWorx の RemoteThing を作成
        // ボタンを押された場合のサービスもここで定義している。
        if ('BME280_thing_name' in config) {
            bme280thing = new Thing(config.BME280_thing_name);
            bme280thing.addProperty({type: 'number', name: 'temperature'});
            bme280thing.addProperty({type: 'number', name: 'humidity'});
            bme280thing.addProperty({type: 'number', name: 'pressure'});
            bme280thing.bind();
        } else {
            throw '\'BME280_thing_name\' IS REQUIRED IN CONFIG.YML, ABORT';
        }

        if (config && config.enableThingworx) {
            api.initialize(); // Initailize the API
            twConnect();
        }
    })
    .catch(err => {
        console.log("INITIALIZATION ERROR: %s", err);
        process.exit(1); // 初期化失敗は異常終了する
    })
    .then(() => raspi.initAsync())
    .then(() => {
        let i2c = new I2C();
        let bme280 = new BME280(i2c);
        return bme280.setupAsync() // センサー初期化
            .catch(err => console.warn('SETUP ERROR: ' + err))
            .delay(1000)
            .then(function loop() {
                // 計測
                return bme280.measureAsync()
                    .catch(err => {
                        console.warn('READ VALUE ERROR: ' + err);
                        process.kill(process.pid, 'SIGTERM');
                    })
                    .then(val => {
                        console.log('VALUES: %j', val);
                        bme280thing.setProperty('temperature', val.temperature);
                        bme280thing.setProperty('humidity', val.humidity);
                        bme280thing.setProperty('pressure', val.pressure);
                    })
                    .catch(err => {
                        console.warn('WRITE PROPERTIES ERROR: ' + err);
                        process.kill(process.pid, 'SIGTERM');
                    })
                    .delay(INTERVAL_MSEC)
                    .then(loop);
            });
    });
