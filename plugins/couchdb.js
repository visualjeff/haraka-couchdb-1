var fs = require('fs')
  , sys = require('sys')
  , request = require('request')
  , Buffers = require('buffers')
  , headers = {'content-type':'application/json', 'accept':'application/json'}
  , transactions = {}
  ;

exports.register = function () {
    this.couchURL = this.config.get('couchdb.url') || 'http://localhost:5984/mail';
};

function attachment() {
    return function() {
        var bufs = Buffers()
          , doc = {_attachments: {}}
          , filename
          ;
        return {
            start: function(content_type, name) {
                filename = name;
                doc._attachments[filename] = {content_type: content_type};
            },
            data: function(data) { bufs.push(data) },
            end: function() { doc._attachments[filename]['data'] = bufs.slice().toString('base64') },
            doc: function() { return doc }
        }
    }();
}

exports.hook_data = function (next, connection) {
    connection.transaction.parse_body = 1;
    var attach = transactions[connection.transaction.uuid] = attachment();
    connection.transaction.attachment_hooks(attach.start, attach.data, attach.end);
    next();
}

function extractChildren(children) {
  return children.map(function(child) {
      var data = {
          bodytext: child.bodytext,
          headers: child.header.headers_decoded
      }
      if (child.children.length > 0) data.children = extractChildren(child.children);
      return data;
  }) 
}

exports.hook_queue = function(next, connection) {
    var doc = transactions[connection.transaction.uuid].doc()
      , body = connection.transaction.body
      ;
    
    doc['headers'] = body.header.headers_decoded;
    doc['parts'] = extractChildren(body.children);
    
    request({uri: this.couchURL, method: "POST", headers: headers, body: JSON.stringify(doc)}, function(err, resp, body) {
        if (err || resp.statusCode > 299) next(DENY, "couch error " + body);
        connection.logdebug(body);
        delete transactions[connection.transaction.uuid];
        next(OK);
    });
};