/**
 * Copyright (c) 2014 Baidu.com, Inc. All Rights Reserved
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with
 * the License. You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on
 * an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the
 * specific language governing permissions and limitations under the License.
 *
 * @file src/bos_client.js
 * @author leeight
 */

/* eslint-env node */
/* eslint max-params:[0,10] */

var util = require('util');
var path = require('path');
var fs = require('fs');
var qs = require('querystring');

var u = require('underscore');
var Q = require('q');

var H = require('./headers');
var strings = require('./strings');
var Auth = require('./auth');
var crypto = require('./crypto');
var HttpClient = require('./http_client');
var BceBaseClient = require('./bce_base_client');
var MimeType = require('./mime.types');
var WMStream = require('./wm_stream');
var Multipart = require('./multipart');

// var MIN_PART_SIZE = 1048576;                // 1M
// var THREAD = 2;
var MAX_PUT_OBJECT_LENGTH = 5368709120; // 5G
var MAX_USER_METADATA_SIZE = 2048; // 2 * 1024
var MIN_PART_NUMBER = 1;
var MAX_PART_NUMBER = 10000;
var MAX_RETRY_COUNT = 3;
var COMMAND_MAP = {
    scale: 's',
    width: 'w',
    height: 'h',
    quality: 'q',
    format: 'f',
    angle: 'a',
    display: 'd',
    limit: 'l',
    crop: 'c',
    offsetX: 'x',
    offsetY: 'y',
    watermark: 'wm',
    key: 'k',
    gravity: 'g',
    gravityX: 'x',
    gravityY: 'y',
    opacity: 'o',
    text: 't',
    fontSize: 'sz',
    fontFamily: 'ff',
    fontColor: 'fc',
    fontStyle: 'fs'
};
var IMAGE_DOMAIN = 'bceimg.com';

/**
 * BOS service api
 *
 * @see http://gollum.baidu.com/BOS_API#BOS-API文档
 *
 * @constructor
 * @param {Object} config The bos client configuration.
 * @extends {BceBaseClient}
 */
function BosClient(config) {
    BceBaseClient.call(this, config, 'bos', true);

    /**
     * @type {HttpClient}
     */
    this._httpAgent = null;
}
util.inherits(BosClient, BceBaseClient);

// --- B E G I N ---
BosClient.prototype.generatePresignedUrl = function (bucketName, key, timestamp,
                                                     expirationInSeconds, headers, params, headersToSign, config) {

    config = u.extend({}, this.config, config);
    params = params || {};

    var resource = path.normalize(path.join(
        config.removeVersionPrefix ? '/' : '/v1',
        /\.[\w\-]+\.bcebos\.com$/.test(config.endpoint) ? '' : strings.normalize(bucketName || ''),
        strings.normalize(key || '', false)
    )).replace(/\\/g, '/');

    headers = headers || {};
    headers.Host = require('url').parse(config.endpoint).host;

    var credentials = config.credentials;
    var auth = new Auth(credentials.ak, credentials.sk);
    var authorization = auth.generateAuthorization(
        'GET', resource, params, headers, timestamp, expirationInSeconds,
        headersToSign);

    params.authorization = authorization;

    return util.format('%s%s?%s', config.endpoint, resource, qs.encode(params));
};

BosClient.prototype.generateUrl = function (bucketName, key, pipeline, cdn, config) {
    config = u.extend({}, this.config, config);
    var resource = path.normalize(path.join(
        config.removeVersionPrefix ? '/' : '/v1',
        strings.normalize(bucketName || ''),
        strings.normalize(key || '', false)
    )).replace(/\\/g, '/');

    // pipeline表示如何对图片进行处理.
    var command = '';
    if (pipeline) {
        if (u.isString(pipeline)) {
            if (/^@/.test(pipeline)) {
                command = pipeline;
            }
            else {
                command = '@' + pipeline;
            }
        }
        else {
            command = '@' + u.map(pipeline, function (params) {
                    return u.map(params, function (value, key) {
                        return [COMMAND_MAP[key] || key, value].join('_');
                    }).join(',');
                }).join('|');
        }
    }
    if (command) {
        // 需要生成图片转码url
        if (cdn) {
            return util.format('http://%s/%s%s', cdn, path.normalize(key), command);
        }
        return util.format('http://%s.%s/%s%s', path.normalize(bucketName), IMAGE_DOMAIN, path.normalize(key), command);
    }
    return util.format('%s%s%s', this.config.endpoint, resource, command);
};

BosClient.prototype.listBuckets = function (options) {
    options = options || {};
    return this.sendRequest('GET', {config: options.config});
};

BosClient.prototype.putBucket =
BosClient.prototype.createBucket = function (bucketName, options) {
    options = options || {};

    return this.sendRequest('PUT', {
        bucketName: bucketName,
        config: options.config
    });
};

// BosClient.prototype.deleteBucketCopyrightProtection =
// BosClient.prototype.getBucketCopyrightProtection =
// BosClient.prototype.putBucketCopyrightProtection =
// BosClient.prototype.deleteBucketCors =
// BosClient.prototype.putBucketCors =
// BosClient.prototype.getBucketCors =
// BosClient.prototype.deleteBucketTrash =
// BosClient.prototype.getBucketTrash =
// BosClient.prototype.putBucketTrash =
// BosClient.prototype.putBucketStaticWebsite =
// BosClient.prototype.getBucketStaticWebsite =
// BosClient.prototype.deleteBucketStaticWebsite =
// BosClient.prototype.deleteBucketEncryption =
// BosClient.prototype.getBucketEncryption =
// BosClient.prototype.putBucketEncryption =
// BosClient.prototype.getBucketStorageclass =
BosClient.prototype.putBucketStorageclass = function (bucketName, storageClass, options) {
    options = options || {};
    var headers = {};
    headers[H.CONTENT_TYPE] = 'application/json; charset=UTF-8';
    return this.sendRequest('PUT', {
        bucketName: bucketName,
        headers: headers,
        params: {storageClass: ''},
        body: JSON.stringify({storageClass: storageClass}),
        config: options.config
    });
};
// BosClient.prototype.deleteBucketLifecycle =
// BosClient.prototype.getBucketLifecycle =
// BosClient.prototype.putBucketLifecycle =
// BosClient.prototype.deleteBucketLogging =
// BosClient.prototype.putBucketLogging =
// BosClient.prototype.getBucketReplicationProgress =
// BosClient.prototype.deleteBucketReplication =
// BosClient.prototype.getBucketReplication =
// BosClient.prototype.putBucketReplication =
// BosClient.prototype.deleteBucket =
// BosClient.prototype.headBucket = function() {
//     throw new Error("Method not implemented.");
// }

BosClient.prototype.listObjects = function (bucketName, options) {
    options = options || {};

    var params = u.extend(
        {maxKeys: 1000},
        u.pick(options, 'maxKeys', 'prefix', 'marker', 'delimiter')
    );

    return this.sendRequest('GET', {
        bucketName: bucketName,
        params: params,
        config: options.config
    });
};

BosClient.prototype.headBucket =
BosClient.prototype.doesBucketExist = function (bucketName, options) {
    options = options || {};

    return this.sendRequest('HEAD', {
        bucketName: bucketName,
        config: options.config
    }).then(
        /* eslint-disable */
        function () {
            return Q(true);
        },
        function (e) {
            if (e && e[H.X_STATUS_CODE] === 403) {
                return Q(true);
            }
            if (e && e[H.X_STATUS_CODE] === 404) {
                return Q(false);
            }
            return Q.reject(e);
        }
        /* eslint-enable */
    );
};

BosClient.prototype.deleteBucket = function (bucketName, options) {
    options = options || {};

    return this.sendRequest('DELETE', {
        bucketName: bucketName,
        config: options.config
    });
};

BosClient.prototype.setBucketCannedAcl = function (bucketName, cannedAcl, options) {
    options = options || {};

    var headers = {};
    headers[H.X_BCE_ACL] = cannedAcl;
    return this.sendRequest('PUT', {
        bucketName: bucketName,
        headers: headers,
        params: {acl: ''},
        config: options.config
    });
};

BosClient.prototype.putBucketAcl = function (bucketName, acl, options) {
    options = options || {};

    var headers = {};
    headers[H.CONTENT_TYPE] = 'application/json; charset=UTF-8';
    headers[H.X_BCE_ACL] = acl;
    return this.sendRequest('PUT', {
        bucketName: bucketName,
        headers: headers,
        params: {acl: ''},
        config: options.config
    });
};

BosClient.prototype.setBucketAcl = function (bucketName, acl, options) {
    options = options || {};

    var headers = {};
    headers[H.CONTENT_TYPE] = 'application/json; charset=UTF-8';
    return this.sendRequest('PUT', {
        bucketName: bucketName,
        body: JSON.stringify({accessControlList: acl}),
        headers: headers,
        params: {acl: ''},
        config: options.config
    });
};

BosClient.prototype.getBucketAcl = function (bucketName, options) {
    options = options || {};

    return this.sendRequest('GET', {
        bucketName: bucketName,
        params: {acl: ''},
        config: options.config
    });
};

BosClient.prototype.getObjectAcl = function (bucketName, key, options) {
    options = options || {};

    return this.sendRequest('GET', {
        bucketName: bucketName,
        key: key,
        params: {acl: ''},
        config: options.config
    });
};

BosClient.prototype.putObjectAcl = function (bucketName, key, acl, options) {
    options = options || {};

    var headers = {};
    headers[H.CONTENT_TYPE] = 'application/json; charset=UTF-8';
    return this.sendRequest('PUT', {
        bucketName: bucketName,
        key: key,
        body: JSON.stringify({accessControlList: acl}),
        headers: headers,
        params: {acl: ''},
        config: options.config
    });
};

BosClient.prototype.putObjectCannedAcl = function (bucketName, key, cannedAcl, options) {
    options = options || {};

    var headers = {};
    headers[H.X_BCE_ACL] = cannedAcl;
    return this.sendRequest('PUT', {
        bucketName: bucketName,
        key: key,
        headers: headers,
        params: {acl: ''},
        config: options.config
    });
};


BosClient.prototype.getBucketLocation = function (bucketName, options) {
    options = options || {};

    return this.sendRequest('GET', {
        bucketName: bucketName,
        params: {location: ''},
        config: options.config
    });
};

BosClient.prototype.deleteMultipleObjects = function (bucketName, objects, options) {
    options = options || {};

    var body = u.map(objects, function (object) {
        return {key: object};
    });

    return this.sendRequest('POST', {
        bucketName: bucketName,
        params: {'delete': ''},
        body: JSON.stringify({
            objects: body
        }),
        config: options.config
    });
};

BosClient.prototype.deleteObject = function (bucketName, key, options) {
    options = options || {};

    return this.sendRequest('DELETE', {
        bucketName: bucketName,
        key: key,
        config: options.config
    });
};

BosClient.prototype.putObject = function (bucketName, key, data, options) {
    if (!key) {
        throw new TypeError('key should not be empty.');
    }

    options = this._checkOptions(options || {});

    return this.sendRequest('PUT', {
        bucketName: bucketName,
        key: key,
        body: data,
        headers: options.headers,
        config: options.config
    });
};

BosClient.prototype.putObjectFromBlob = function (bucketName, key, blob, options) {
    var headers = {};

    // https://developer.mozilla.org/en-US/docs/Web/API/Blob/size
    headers[H.CONTENT_LENGTH] = blob.size;
    // 对于浏览器调用API的时候，默认不添加 H.CONTENT_MD5 字段，因为计算起来比较慢
    // 而且根据 API 文档，这个字段不是必填的。
    options = u.extend(headers, options);

    return this.putObject(bucketName, key, blob, options);
};

BosClient.prototype.putObjectFromDataUrl = function (bucketName, key, data, options) {
    data = new Buffer(data, 'base64');

    var headers = {};
    headers[H.CONTENT_LENGTH] = data.length;
    // 对于浏览器调用API的时候，默认不添加 H.CONTENT_MD5 字段，因为计算起来比较慢
    // headers[H.CONTENT_MD5] = require('./crypto').md5sum(data);
    options = u.extend(headers, options);

    return this.putObject(bucketName, key, data, options);
};

BosClient.prototype.putObjectFromString = function (bucketName, key, data, options) {
    options = options || {};

    var headers = {};
    headers[H.CONTENT_LENGTH] = Buffer.byteLength(data);
    headers[H.CONTENT_TYPE] = options[H.CONTENT_TYPE] || MimeType.guess(path.extname(key));
    headers[H.CONTENT_MD5] = crypto.md5sum(data);
    options = u.extend(headers, options);

    return this.putObject(bucketName, key, data, options);
};

BosClient.prototype.putObjectFromFile = function (bucketName, key, filename, options) {
    options = options || {};

    var headers = {};

    // 如果没有显式的设置，就使用默认值
    var fileSize = fs.statSync(filename).size;
    var contentLength = u.has(options, H.CONTENT_LENGTH)
        ? options[H.CONTENT_LENGTH]
        : fileSize;
    if (contentLength > fileSize) {
        throw new Error('options[\'Content-Length\'] should less than ' + fileSize);
    }

    headers[H.CONTENT_LENGTH] = contentLength;

    // 因为Firefox会在发起请求的时候自动给 Content-Type 添加 charset 属性
    // 导致我们计算签名的时候使用的 Content-Type 值跟服务器收到的不一样，为了
    // 解决这个问题，我们需要显式的声明Charset
    headers[H.CONTENT_TYPE] = options[H.CONTENT_TYPE] || MimeType.guess(path.extname(filename));
    options = u.extend(headers, options);

    var streamOptions = {
        start: 0,
        end: Math.max(0, contentLength - 1)
    };

    var me = this;

    function putObjectWithRetry(lastRetryTimes) {
        return me.putObject(bucketName, key, fs.createReadStream(filename, streamOptions), options)
            .catch(function (err) {
                var serverTimestamp = new Date(err[H.X_BCE_DATE]).getTime();

                BceBaseClient.prototype.timeOffset = serverTimestamp - Date.now();

                if (err[H.X_STATUS_CODE] === 400 && err[H.X_CODE] === 'Http400' && lastRetryTimes > 0) {
                    return putObjectWithRetry(--lastRetryTimes);
                }

                return Q.reject(err);
            });
    }

    if (!u.has(options, H.CONTENT_MD5)) {
        var fp2 = fs.createReadStream(filename, streamOptions);
        return crypto.md5stream(fp2)
            .then(function (md5sum) {
                options[H.CONTENT_MD5] = md5sum;
                return putObjectWithRetry(options.retryCount || MAX_RETRY_COUNT);
            });
    }

    return putObjectWithRetry(options.retryCount || MAX_RETRY_COUNT);
};

BosClient.prototype.getObjectMetadata = function (bucketName, key, options) {
    options = options || {};

    return this.sendRequest('HEAD', {
        bucketName: bucketName,
        key: key,
        config: options.config
    });
};

BosClient.prototype.getObject = function (bucketName, key, range, options) {
    if (!key) {
        throw new TypeError('key should not be empty.');
    }
    else if (/\/\/+/.test(key)) {
        throw new TypeError('key should not contain consecutive forward slashes (/).');
    }
    else if (/^[/\\]/.test(key) || /[/\\]$/.test(key)) {
        throw new TypeError('key should not start or end with a forward slash (/) or a backslash (\\).');
    }
    else if (/\/\.\.\//.test(key)) {
        throw new TypeError('path in key should not contain consecutive periods (..).');
    }

    options = options || {};

    var outputStream = new WMStream();
    return this.sendRequest('GET', {
        bucketName: bucketName,
        key: key,
        headers: {
            Range: range ? util.format('bytes=%s', range) : ''
        },
        config: options.config,
        outputStream: outputStream
    }).then(function (response) {
        response.body = outputStream.store;
        return response;
    });
};

BosClient.prototype.getObjectToFile = function (bucketName, key, filename, range, options) {
    if (!key) {
        throw new TypeError('key should not be empty.');
    }
    else if (/\/\/+/.test(key)) {
        throw new TypeError('key should not contain consecutive forward slashes (/).');
    }
    else if (/^[/\\]/.test(key) || /[/\\]$/.test(key)) {
        throw new TypeError('key should not start or end with a forward slash (/) or a backslash (\\).');
    }
    else if (/\/\.\.\//.test(key)) {
        throw new TypeError('path in key should not contain consecutive periods (..).');
    }

    options = options || {};

    return this.sendRequest('GET', {
        bucketName: bucketName,
        key: key,
        headers: {
            Range: range ? util.format('bytes=%s', range) : ''
        },
        config: options.config,
        outputStream: fs.createWriteStream(filename)
    });
};

BosClient.prototype.copyObject = function (sourceBucketName, sourceKey, targetBucketName, targetKey, options) {
    /* eslint-disable */
    if (!sourceBucketName) {
        throw new TypeError('sourceBucketName should not be empty');
    }
    if (!sourceKey) {
        throw new TypeError('sourceKey should not be empty');
    }
    if (!targetBucketName) {
        throw new TypeError('targetBucketName should not be empty');
    }
    if (!targetKey) {
        throw new TypeError('targetKey should not be empty');
    }
    /* eslint-enable */

    options = this._checkOptions(options || {});
    var hasUserMetadata = false;
    u.some(options.headers, function (value, key) {
        if (key.indexOf('x-bce-meta-') === 0) {
            hasUserMetadata = true;
            return true;
        }
    });
    options.headers['x-bce-copy-source'] = strings.normalize(util.format('/%s/%s',
        sourceBucketName, sourceKey), false);
    if (u.has(options.headers, 'ETag')) {
        options.headers['x-bce-copy-source-if-match'] = options.headers.ETag;
    }
    options.headers['x-bce-metadata-directive'] = hasUserMetadata ? 'replace' : 'copy';

    return this.sendRequest('PUT', {
        bucketName: targetBucketName,
        key: targetKey,
        headers: options.headers,
        config: options.config
    });
};

BosClient.prototype.initiateMultipartUpload = function (bucketName, key, options) {
    options = options || {};

    var headers = {};
    headers[H.CONTENT_TYPE] = MimeType.guess(path.extname(key));

    options = this._checkOptions(u.extend(headers, options));

    return this.sendRequest('POST', {
        bucketName: bucketName,
        key: key,
        params: {uploads: ''},
        headers: options.headers,
        config: options.config
    });
};

BosClient.prototype.abortMultipartUpload = function (bucketName, key, uploadId, options) {
    options = options || {};

    return this.sendRequest('DELETE', {
        bucketName: bucketName,
        key: key,
        params: {uploadId: uploadId},
        config: options.config
    });
};

BosClient.prototype.completeMultipartUpload = function (bucketName, key, uploadId, partList, options) {
    var headers = {};
    headers[H.CONTENT_TYPE] = 'application/json; charset=UTF-8';
    options = this._checkOptions(u.extend(headers, options));

    return this.sendRequest('POST', {
        bucketName: bucketName,
        key: key,
        body: JSON.stringify({parts: partList}),
        headers: options.headers,
        params: {uploadId: uploadId},
        config: options.config
    });
};

BosClient.prototype.uploadPartFromFile = function (bucketName, key, uploadId, partNumber,
                                                   partSize, filename, offset, options) {

    var start = offset;
    var end = offset + partSize - 1;
    var partFp = fs.createReadStream(filename, {
        start: start,
        end: end
    });
    return this.uploadPart(bucketName, key, uploadId, partNumber,
        partSize, partFp, options);
};

BosClient.prototype.uploadPartFromBlob = function (bucketName, key, uploadId, partNumber,
                                                   partSize, blob, options) {
    if ((blob.size||blob.length) !== partSize) {
        throw new TypeError(util.format('Invalid partSize %d and data length %d',
            partSize, blob.size));
    }

    var headers = {};
    headers[H.CONTENT_LENGTH] = partSize;
    headers[H.CONTENT_TYPE] = 'application/octet-stream';
    // 对于浏览器调用API的时候，默认不添加 H.CONTENT_MD5 字段，因为计算起来比较慢
    // headers[H.CONTENT_MD5] = require('./crypto').md5sum(data);

    options = this._checkOptions(u.extend(headers, options));
    return this.sendRequest('PUT', {
        bucketName: bucketName,
        key: key,
        body: blob,
        headers: options.headers,
        params: {
            partNumber: partNumber,
            uploadId: uploadId
        },
        config: options.config
    });
};

BosClient.prototype.uploadPartFromDataUrl = function (bucketName, key, uploadId, partNumber,
                                                      partSize, dataUrl, options) {

    var data = new Buffer(dataUrl, 'base64');
    if (data.length !== partSize) {
        throw new TypeError(util.format('Invalid partSize %d and data length %d',
            partSize, data.length));
    }

    var headers = {};
    headers[H.CONTENT_LENGTH] = partSize;
    headers[H.CONTENT_TYPE] = 'application/octet-stream';
    // 对于浏览器调用API的时候，默认不添加 H.CONTENT_MD5 字段，因为计算起来比较慢
    // headers[H.CONTENT_MD5] = require('./crypto').md5sum(data);

    options = this._checkOptions(u.extend(headers, options));
    return this.sendRequest('PUT', {
        bucketName: bucketName,
        key: key,
        body: data,
        headers: options.headers,
        params: {
            partNumber: partNumber,
            uploadId: uploadId
        },
        config: options.config
    });
};

BosClient.prototype.uploadPart = function (bucketName, key, uploadId, partNumber,
                                           partSize, partFp, options) {

    /* eslint-disable */
    if (!bucketName) {
        throw new TypeError('bucketName should not be empty');
    }
    if (!key) {
        throw new TypeError('key should not be empty');
    }
    /* eslint-enable */
    if (partNumber < MIN_PART_NUMBER || partNumber > MAX_PART_NUMBER) {
        throw new TypeError(util.format('Invalid partNumber %d. The valid range is from %d to %d.',
            partNumber, MIN_PART_NUMBER, MAX_PART_NUMBER));
    }

    var client = this;

    // TODO(leeight) 计算md5的时候已经把 partFp 读完了，如果从头再来呢？
    var clonedPartFp = fs.createReadStream(partFp.path, {
        start: partFp.start,
        end: partFp.end
    });

    var headers = {};
    headers[H.CONTENT_LENGTH] = partSize;
    headers[H.CONTENT_TYPE] = 'application/octet-stream';
    // headers[H.CONTENT_MD5] = partMd5;
    options = u.extend(headers, options);

    if (!options[H.CONTENT_MD5]) {
        return crypto.md5stream(partFp)
            .then(function (md5sum) {
                options[H.CONTENT_MD5] = md5sum;
                return newPromise();
            });
    }

    function newPromise() {
        options = client._checkOptions(options);
        return client.sendRequest('PUT', {
            bucketName: bucketName,
            key: key,
            body: clonedPartFp,
            headers: options.headers,
            params: {
                partNumber: partNumber,
                uploadId: uploadId
            },
            config: options.config
        });
    }

    return newPromise();
};

BosClient.prototype.uploadPartCopy = function (sourceBucket, sourceKey, targetBucket, targetKey,
                                            uploadId, partNumber, range, options) {
    if (!sourceBucket) {
        throw new TypeError('sourceBucket should not be empty');
    }
    if (!sourceKey) {
        throw new TypeError('sourceKey should not be empty');
    }
    if (!targetBucket) {
        throw new TypeError('targetBucket should not be empty');
    }
    if (!targetKey) {
        throw new TypeError('targetKey should not be empty');
    }
    if (partNumber < MIN_PART_NUMBER || partNumber > MAX_PART_NUMBER) {
        throw new TypeError(util.format('Invalid partNumber %d. The valid range is from %d to %d.',
            partNumber, MIN_PART_NUMBER, MAX_PART_NUMBER));
    }

    options = this._checkOptions(options || {});
    options.headers['x-bce-copy-source'] = strings.normalize(util.format('/%s/%s', sourceBucket, sourceKey), false);
    options.headers['x-bce-copy-source-range'] = range ? util.format('bytes=%s', range) : '';

    return this.sendRequest('PUT', {
        bucketName: targetBucket,
        key: targetKey,
        headers: options.headers,
        config: options.config,
        params: {partNumber: partNumber, uploadId: uploadId}
    });
}

BosClient.prototype.listParts = function (bucketName, key, uploadId, options) {
    /* eslint-disable */
    if (!uploadId) {
        throw new TypeError('uploadId should not empty');
    }
    /* eslint-enable */

    var allowedParams = ['maxParts', 'partNumberMarker', 'uploadId'];
    options = this._checkOptions(options || {}, allowedParams);
    options.params.uploadId = uploadId;

    return this.sendRequest('GET', {
        bucketName: bucketName,
        key: key,
        params: options.params,
        config: options.config
    });
};

BosClient.prototype.listMultipartUploads = function (bucketName, options) {
    var allowedParams = ['delimiter', 'maxUploads', 'keyMarker', 'prefix', 'uploads'];

    options = this._checkOptions(options || {}, allowedParams);
    options.params.uploads = '';

    return this.sendRequest('GET', {
        bucketName: bucketName,
        params: options.params,
        config: options.config
    });
};

BosClient.prototype.appendObject = function (bucketName, key, data, offset, options) {
    if (!key) {
        throw new TypeError('key should not be empty.');
    }

    options = this._checkOptions(options || {});
    var params = {append: ''};
    if (u.isNumber(offset)) {
        params.offset = offset;
    }
    return this.sendRequest('POST', {
        bucketName: bucketName,
        key: key,
        body: data,
        headers: options.headers,
        params: params,
        config: options.config
    });
};

BosClient.prototype.appendObjectFromBlob = function (bucketName, key, blob, offset, options) {
    var headers = {};

    // https://developer.mozilla.org/en-US/docs/Web/API/Blob/size
    headers[H.CONTENT_LENGTH] = blob.size;
    // 对于浏览器调用API的时候，默认不添加 H.CONTENT_MD5 字段，因为计算起来比较慢
    // 而且根据 API 文档，这个字段不是必填的。
    options = u.extend(headers, options);

    return this.appendObject(bucketName, key, blob, offset, options);
};

BosClient.prototype.appendObjectFromDataUrl = function (bucketName, key, data, offset, options) {
    data = new Buffer(data, 'base64');

    var headers = {};
    headers[H.CONTENT_LENGTH] = data.length;
    // 对于浏览器调用API的时候，默认不添加 H.CONTENT_MD5 字段，因为计算起来比较慢
    // headers[H.CONTENT_MD5] = require('./crypto').md5sum(data);
    options = u.extend(headers, options);

    return this.appendObject(bucketName, key, data, offset, options);
};

BosClient.prototype.appendObjectFromString = function (bucketName, key, data, offset, options) {
    options = options || {};

    var headers = {};
    headers[H.CONTENT_LENGTH] = Buffer.byteLength(data);
    headers[H.CONTENT_TYPE] = options[H.CONTENT_TYPE] || MimeType.guess(path.extname(key));
    headers[H.CONTENT_MD5] = crypto.md5sum(data);
    options = u.extend(headers, options);

    return this.appendObject(bucketName, key, data, offset, options);
};

BosClient.prototype.appendObjectFromFile = function (bucketName, key, filename, offset, size, options) {
    options = options || {};
    if (size === 0) {
        return this.appendObjectFromString(bucketName, key, '', offset, options);
    }

    var headers = {};

    // append的起止位置应该在文件内
    var fileSize = fs.statSync(filename).size;
    if (size + offset > fileSize) {
        throw new Error('Can\'t read the content beyond the end of file.');
    }

    headers[H.CONTENT_LENGTH] = size;

    // 因为Firefox会在发起请求的时候自动给 Content-Type 添加 charset 属性
    // 导致我们计算签名的时候使用的 Content-Type 值跟服务器收到的不一样，为了
    // 解决这个问题，我们需要显式的声明Charset
    headers[H.CONTENT_TYPE] = options[H.CONTENT_TYPE] || MimeType.guess(path.extname(filename));
    options = u.extend(headers, options);

    var streamOptions = {
        start: offset || 0,
        end: (offset || 0) + size - 1
    };
    var fp = fs.createReadStream(filename, streamOptions);
    if (!u.has(options, H.CONTENT_MD5)) {
        var me = this;
        var fp2 = fs.createReadStream(filename, streamOptions);
        return crypto.md5stream(fp2)
            .then(function (md5sum) {
                options[H.CONTENT_MD5] = md5sum;
                return me.appendObject(bucketName, key, fp, offset, options);
            });
    }

    return this.appendObject(bucketName, key, fp, offset, options);
};

/**
 * Generate PostObject policy signature.
 *
 * @param {Object} policy The policy object.
 * @return {string}
 */
BosClient.prototype.signPostObjectPolicy = function (policy) {
    var credentials = this.config.credentials;
    var auth = new Auth(credentials.ak, credentials.sk);

    policy = new Buffer(JSON.stringify(policy)).toString('base64');
    var signature = auth.hash(policy, credentials.sk);

    return {
        policy: policy,
        signature: signature
    };
};

/**
 * Post an object.
 *
 * @see {http://wiki.baidu.com/pages/viewpage.action?pageId=161461681}
 *
 * @param {string} bucketName The bucket name.
 * @param {string} key The object name.
 * @param {string|Buffer} data The file raw data or file path.
 * @param {Object} options The form fields.
 * @return {Promise}
 */
BosClient.prototype.postObject = function (bucketName, key, data, options) {
    var boundary = 'MM8964' + (Math.random() * Math.pow(2, 63)).toString(36);
    var contentType = 'multipart/form-data; boundary=' + boundary;

    if (u.isString(data)) {
        data = fs.readFileSync(data);
    }
    else if (!Buffer.isBuffer(data)) {
        throw new Error('Invalid data type.');
    }

    var credentials = this.config.credentials;
    var ak = credentials.ak;

    var blacklist = ['signature', 'accessKey', 'key', 'file'];
    options = u.omit(options || {}, blacklist);

    var multipart = new Multipart(boundary);
    for (var k in options) {
        if (options.hasOwnProperty(k)) {
            if (k !== 'policy') {
                multipart.addPart(k, options[k]);
            }
        }
    }

    if (options.policy) {
        var rv = this.signPostObjectPolicy(options.policy);
        multipart.addPart('policy', rv.policy);
        multipart.addPart('signature', rv.signature);
    }

    multipart.addPart('accessKey', ak);
    multipart.addPart('key', key);
    multipart.addPart('file', data);

    var body = multipart.encode();

    var headers = {};
    headers[H.CONTENT_TYPE] = contentType;

    return this.sendRequest('POST', {
        bucketName: bucketName,
        body: body,
        headers: headers
    });
};

// --- E N D ---

BosClient.prototype.sendRequest = function (httpMethod, varArgs) {
    var defaultArgs = {
        bucketName: null,
        key: null,
        body: null,
        headers: {},
        params: {},
        config: {},
        outputStream: null
    };
    var args = u.extend(defaultArgs, varArgs);

    var config = u.extend({}, this.config, args.config);
    var resource = path.normalize(path.join(
        args.removeVersionPrefix ? '/' : '/v1',
        /\.[\w\-]+\.bcebos\.com$/.test(config.endpoint) ? '' : strings.normalize(args.bucketName || ''),
        strings.normalize(args.key || '', false)
    )).replace(/\\/g, '/');

    if (config.sessionToken) {
        args.headers[H.SESSION_TOKEN] = config.sessionToken;
    }

    return this.sendHTTPRequest(httpMethod, resource, args, config);
};

// BosClient.prototype.createSignature = function (credentials, httpMethod, path, params, headers) {
//     var revisionTimestamp = Date.now() + (this.timeOffset || 0);

//     headers[H.X_BCE_DATE] = new Date(revisionTimestamp).toISOString().replace(/\.\d+Z$/, 'Z');

//     var auth = new Auth(credentials.ak, credentials.sk);
//     return auth.generateAuthorization(httpMethod, path, params, headers, revisionTimestamp / 1000);
// };

BosClient.prototype.sendHTTPRequest = function (httpMethod, resource, args, config) {
    var client = this;

    function doRequest() {
        var agent = this._httpAgent = new HttpClient(config);

        var httpContext = {
            httpMethod: httpMethod,
            resource: resource,
            args: args,
            config: config
        };
        u.each(['progress', 'error', 'abort', 'timeout'], function (eventName) {
            agent.on(eventName, function (evt) {
                client.emit(eventName, evt, httpContext);
            });
        });

        var promise = this._httpAgent.sendRequest(httpMethod, resource, args.body,
            args.headers, args.params, u.bind(this.createSignature, this),
            args.outputStream
        );

        promise.abort = function () {
            if (agent._req && agent._req.xhr) {
                var xhr = agent._req.xhr;
                xhr.abort();
            }
        };

        return promise;
    }


    return doRequest.call(client).catch(function (err) {
        var serverTimestamp = new Date(err[H.X_BCE_DATE]).getTime();

        BceBaseClient.prototype.timeOffset = serverTimestamp - Date.now();

        if (err[H.X_STATUS_CODE] === 403 && err[H.X_CODE] === 'RequestTimeTooSkewed') {
            return doRequest.call(client);
        }

        return Q.reject(err);
    });
};

BosClient.prototype._checkOptions = function (options, allowedParams) {
    var rv = {};

    rv.config = options.config || {};
    rv.headers = this._prepareObjectHeaders(options);
    rv.params = u.pick(options, allowedParams || []);

    return rv;
};

BosClient.prototype._prepareObjectHeaders = function (options) {
    var allowedHeaders = [
        H.CONTENT_LENGTH,
        H.CONTENT_ENCODING,
        H.CONTENT_MD5,
        H.X_BCE_CONTENT_SHA256,
        H.CONTENT_TYPE,
        H.CONTENT_DISPOSITION,
        H.ETAG,
        H.SESSION_TOKEN,
        H.CACHE_CONTROL,
        H.EXPIRES,
        H.X_BCE_ACL,
        H.X_BCE_GRANT_READ,
        H.X_BCE_GRANT_FULL_CONTROL,
        H.X_BCE_OBJECT_ACL,
        H.X_BCE_OBJECT_GRANT_READ,
        H.X_BCE_STORAGE_CLASS
    ];
    var metaSize = 0;
    var headers = u.pick(options, function (value, key) {
        if (allowedHeaders.indexOf(key) !== -1) {
            return true;
        }
        else if (/^x\-bce\-meta\-/.test(key)) {
            metaSize += Buffer.byteLength(key) + Buffer.byteLength('' + value);
            return true;
        }
    });

    if (metaSize > MAX_USER_METADATA_SIZE) {
        throw new TypeError('Metadata size should not be greater than ' + MAX_USER_METADATA_SIZE + '.');
    }

    if (u.has(headers, H.CONTENT_LENGTH)) {
        var contentLength = headers[H.CONTENT_LENGTH];
        if (contentLength < 0) {
            throw new TypeError('content_length should not be negative.');
        }
        else if (contentLength > MAX_PUT_OBJECT_LENGTH) { // 5G
            throw new TypeError('Object length should be less than ' + MAX_PUT_OBJECT_LENGTH
                + '. Use multi-part upload instead.');
        }
    }

    if (u.has(headers, 'ETag')) {
        var etag = headers.ETag;
        if (!/^"/.test(etag)) {
            headers.ETag = util.format('"%s"', etag);
        }
    }

    if (!u.has(headers, H.CONTENT_TYPE)) {
        headers[H.CONTENT_TYPE] = 'application/octet-stream';
    }

    if (u.has(headers, H.X_BCE_STORAGE_CLASS)) {
        const storageClass = headers[H.X_BCE_STORAGE_CLASS];
        const STORAGE_CLASS = [
            /** 标准存储类型 */
            'STANDARD',
            /** 低频存储 */
            'STANDARD_IA',
            /** 归档存储 */
            'ARCHIVE',
            /** 冷存储 */
            'COLD',
            /** 标准存储-多AZ */
            'MAZ_STANDARD',
            /** 低频存储-多AZ */
            'MAZ_STANDARD_IA'
        ];

        if (!STORAGE_CLASS.includes(storageClass)) {
            headers[H.X_BCE_STORAGE_CLASS] = STORAGE_CLASS[0];
        }
    }

    return headers;
};

module.exports = BosClient;
