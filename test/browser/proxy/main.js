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
 */

var fs = require('fs');
var url = require('url');
var path = require('path');
var http = require('http');

var httpProxy = require('http-proxy');

// 10.32.249.237   qasandbox.bcetest.baidu.com
// 10.107.37.49    rdsandbox.bcetest.baidu.com
// var kDefaultTarget = 'http://10.105.97.15';
// var kDefaultHost = '10.105.97.15';
var kDefaultTarget = 'http://bs.baidu.com';
var kDefaultHost = 'bs.baidu.com';
var kWebRoot = '/Users/leeight/hd/local/case/inf/bos/baidubce-sdk/test/browser/demo';

var proxy = httpProxy.createProxyServer({});
proxy.on('proxyReq', function (proxyReq, req, res, options) {
    if (options.host) {
        proxyReq.setHeader('Host', options.host);
    }
});
proxy.on('error', function (e) {
    console.error(e);
});

console.log("Listening on port 8964")
http.createServer(function (req, res) {
    var target = kDefaultTarget;
    var host = kDefaultHost;

    var pathname = url.parse(req.url).pathname;
    if (req.method === 'GET'
        && req.url.indexOf('sign=') === -1
        && fs.existsSync(path.join(kWebRoot, pathname))) {
        target = 'http://127.0.0.1:8080';
        host = '127.0.0.1:8080';
    }

    console.log('[%s] %s%s', req.method, target, req.url);

    proxy.web(req, res, {
        target: target,
        // bos server 限定了 Request Header 里面的 Host
        // 因此不能随便设置了，必须跟请求的服务保持一致
        host: host
    });
}).listen(8964);










/* vim: set ts=4 sw=4 sts=4 tw=120: */
