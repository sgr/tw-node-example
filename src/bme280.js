/*jslint node: true, bitwise: true */
'use strict';
require('console-stamp')(console, {pattern: "yyyy-mm-dd HH:MM:ss.l"});
const util = require('util');

const BME280_I2C_ADDR = 0x76;
const BME280_CMD_SETUP = new Buffer([0xf5, 0xa0, 0xf2, 0x01, 0xf4, 0x23]);
const BME280_CMD_CALIB_PARAM_PT = 0x88;
const BME280_CMD_CALIB_PARAM_H1 = 0xa1;
const BME280_CMD_CALIB_PARAM_H2 = 0xe1;
const BME280_CMD_READ = 0xf7;

const BME280 = function(i2c) {
    this.i2c = i2c;
};

BME280.prototype.setup = function(cb) {
    this.i2c.writeSync(BME280_I2C_ADDR, BME280_CMD_SETUP);

    // 温度と圧力の校正値
    this.i2c.writeByteSync(BME280_I2C_ADDR, BME280_CMD_CALIB_PARAM_PT);
    let data = this.i2c.readSync(BME280_I2C_ADDR, 24);
    let digP = data.slice(6, 24);
    let digT = data.slice(0, 6);
    console.log('DIG_P: %j', digP.toJSON().data);
    console.log('DIG_T: %j', digT.toJSON().data);
    this.digPs(digP);
    this.digTs(digT);

    // 湿度の校正値(1)
    this.i2c.writeByteSync(BME280_I2C_ADDR, BME280_CMD_CALIB_PARAM_H1);
    let digH1 = this.i2c.readSync(BME280_I2C_ADDR, 1);

    // 湿度の校正値(2)
    this.i2c.writeByteSync(BME280_I2C_ADDR, BME280_CMD_CALIB_PARAM_H2);
    let digH2 = this.i2c.readSync(BME280_I2C_ADDR, 7);
    let digH = Buffer.concat([digH1, digH2], 8);
    console.log('DIG_H: %j', digH.toJSON().data);
    this.digHs(digH);

    cb(null);
};


BME280.prototype.convertMeasurement = function(data) {
    let val = this.compensate(data);
    return val;
};

BME280.prototype.measure = function(cb) {
    this.i2c.writeByteSync(BME280_I2C_ADDR, BME280_CMD_READ);
    let data = this.i2c.readSync(BME280_I2C_ADDR, 8);
    let val = this.compensate(data);
    cb(null, val);
};

BME280.prototype.digPs = function (digP) {
    this.digP1 = digP.readUInt16LE(0);
    this.digP2 = digP.readInt16LE(2);
    this.digP3 = digP.readInt16LE(4);
    this.digP4 = digP.readInt16LE(6);
    this.digP5 = digP.readInt16LE(8);
    this.digP6 = digP.readInt16LE(10);
    this.digP7 = digP.readInt16LE(12);
    this.digP8 = digP.readInt16LE(14);
    this.digP9 = digP.readInt16LE(16);
};

BME280.prototype.digTs = function (digT) {
    this.digT1 = digT.readUInt16LE(0);
    this.digT2 = digT.readInt16LE(2);
    this.digT3 = digT.readInt16LE(4);
};

BME280.prototype.digHs = function (digH) {
    this.digH1 = digH.readUInt8(0);
    this.digH2 = digH.readInt16LE(1);
    this.digH3 = digH.readUInt8(3);
    this.digH4 = (digH[4] << 4) | (digH[5] & 0x0f);
    this.digH5 = (digH[6] << 4) | ((digH[5] >> 4) & 0x0f);
    this.digH6 = digH.readInt8(7);
};

BME280.prototype.compensate = function(data) {
    let val = {};
    let adc_P = (data[0] << 12) | (data[1] << 4) | (data[2] >> 4);
    let adc_T = (data[3] << 12) | (data[4] << 4) | (data[5] >> 4);
    let adc_H = (data[6] << 8)  | data[7];
    // val.raw = {};
    // val.raw.temperature = adc_T;
    // val.raw.pressure = adc_P;
    // val.raw.humidity = adc_H;

    // t_fineの更新のため必ず compensate_T から始める
    val.temperature = this.compensateT(adc_T);
    val.pressure = this.compensateP(adc_P);
    val.humidity = this.compensateH(adc_H);
    return val;
};

BME280.prototype.compensateT = function(adc_T) {
    // let var1 = (adc_T / 16384.0 - this.digT1 / 1024.0) * this.digT2;
    // let var2 = (adc_T / 131072.0 - this.digT1 / 8192.0) * (adc_T / 131072.0 - this.digT1 / 8192.0) * this.digT3;
    // this.t_fine = var1 + var2;
    // return (var1 + var2) / 5120.0;
    let var1 = ((((adc_T>>3) - (this.digT1<<1))) * (this.digT2)) >> 11;
    let var2 = (((((adc_T>>4) - this.digT1) * ((adc_T>>4) - this.digT1)) >> 12) * this.digT3) >> 14;
    this.t_fine = var1 + var2;
    let T = (this.t_fine * 5 + 128) >> 8;
    return T / 100.0;
};

BME280.prototype.compensateP = function(adc_P) {
    let var1 = (this.t_fine/2.0) - 64000.0;
    let var2 = var1 * var1 * this.digP6 / 32768.0;
    var2 = var2 + var1 * this.digP5 * 2.0;
    var2 = (var2/4.0)+(this.digP4 * 65536.0);
    var1 = (this.digP3 * var1 * var1 / 524288.0 + this.digP2 * var1) / 524288.0;
    var1 = (1.0 + var1 / 32768.0)*this.digP1;
    if (var1 == 0.0) {
        return 0;
    }
    let p = 1048576.0 - adc_P;
    p = (p - (var2 / 4096.0)) * 6250.0 / var1;
    var1 = this.digP9 * p * p / 2147483648.0;
    var2 = p * this.digP8 / 32768.0;
    p = p + (var1 + var2 + this.digP7) / 16.0;
    return p / 100.0; // Pa -> hPa
};

BME280.prototype.compensateH = function(adc_H) {
    let var_H = (this.t_fine - 76800.0);
    var_H = (adc_H - (this.digH4 * 64.0 + this.digH5 / 16384.0 * var_H)) *
        (this.digH2 / 65536.0 * (1.0 + this.digH6 / 67108864.0 * var_H *
                                 (1.0 + this.digH3 / 67108864.0 * var_H)));
    var_H = var_H * (1.0 - this.digH1 * var_H / 524288.0);
    if (var_H > 100.0) {
        var_H = 100.0;
    } else if (var_H < 0.0) {
        var_H = 0.0;
    }
    return var_H;
    // let v_x1_u32r = (this.t_fine - 76800);
    // v_x1_u32r = (((((adc_H << 14) - (this.digH4 << 20) - (this.digH5 * v_x1_u32r)) + 16384) >> 15)
    //              * (((((((v_x1_u32r * this.digH6) >> 10) * (((v_x1_u32r * this.digH3) >> 11) + 32768)) >> 10)
    //                   + 2097152) * this.digH2 + 8192) >> 14));
    // v_x1_u32r = (v_x1_u32r - (((((v_x1_u32r >> 15) * (v_x1_u32r >> 15)) >> 7) * this.digH1) >> 4));
    // v_x1_u32r = (v_x1_u32r < 0 ? 0 : v_x1_u32r);
    // v_x1_u32r = (v_x1_u32r > 419430400 ? 419430400 : v_x1_u32r);
    // let uv = v_x1_u32r>>12;
    // let var_H = uv / 1024.0;
    // return var_H;
};

module.exports = BME280;
