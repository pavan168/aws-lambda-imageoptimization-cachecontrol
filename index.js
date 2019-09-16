// dependencies
var async = require('async');
var AWS = require('aws-sdk');
var gm = require('gm')
            .subClass({ imageMagick: true }); // Enable ImageMagick integration.
var util = require('util');

// define your constants
var MAX_WIDTH  = 1024;
var MAX_HEIGHT = 768;
var CacheControlHeader = 'max-age=31536000';

// get reference to S3 client 
var s3 = new AWS.S3({
    apiVersion: '2006-03-01'
 });
 
 function getSNSMessageObject(msgString) {
   var x = msgString.replace(/\\/g,'');
   var y = x.substring(1,x.length-1);
   var z = JSON.parse(y);
   
   return z;
}

exports.handler = function(event, context, callback) {
    
    // Read options from the event.
    var snsMsgString = JSON.stringify(event.Records[0].Sns.Message);
    var snsMsgObject = getSNSMessageObject(snsMsgString);
    var srcBucket = snsMsgObject.Records[0].s3.bucket.name;
    // Object key may have spaces or unicode non-ASCII characters.
    var srcKey    =
    decodeURIComponent(snsMsgObject.Records[0].s3.object.key.replace(/\+/g, " "));  
    var dstBucket = srcBucket;
    var dstKey    = "yourfolder/" + srcKey;

    // Infer the image type.
    var typeMatch = srcKey.match(/\.([^.]*)$/);
    if (!typeMatch) {
        callback("Could not determine the image type.");
        return;
    }
    var imageType = typeMatch[1];
    if (imageType != "jpeg" && imageType != "jpg" && imageType != "png") {
        callback('Unsupported image type: ${imageType}');
        return;
    }

    // Download the image from S3, optimize, and upload to a different S3 bucket.
    async.waterfall([
        function download(next) {
            // Download the image from S3 into a buffer.
            s3.getObject({
                    Bucket: srcBucket,
                    Key: srcKey
                },
                next);
            },
        function transform(response, next) {
            gm(response.Body).size(function(err, size) {
                // Infer the scaling factor to avoid stretching the image unnaturally.
                var scalingFactor = Math.min(
                    MAX_WIDTH / size.width,
                    MAX_HEIGHT / size.height
                );
                var width  = scalingFactor * size.width;
                var height = scalingFactor * size.height;

                // Transform the image buffer in memory.
                this.resize(width, height)
                    .toBuffer(imageType, function(err, buffer) {
                        if (err) {
                            next(err);
                        } else {
                            next(null, response.ContentType, buffer);
                        }
                    });
            });
        },
        function upload(contentType, data, next) {
            // Stream the transformed image to a different S3 bucket.
            s3.putObject({
                    Bucket: dstBucket,
                    Key: dstKey,
                    Body: data,
                    ContentType: contentType,
                    CacheControl: CacheControlHeader, 
                },
                next);
            }
        ], function (err) {
            if (err) {
                callback(null, "error - enable to resize");
            } else {
                callback(null, 'Successfully resized ' + srcBucket + '/' + srcKey + ' and uploaded to ' + dstBucket + '/' + dstKey);
            }   
        }
    );
};