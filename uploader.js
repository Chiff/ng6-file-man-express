const settings = require('./settings.js');

const mkdirp = require('mkdirp');
const multiparty = require('multiparty');
const fs = require('fs');
const rimraf = require('rimraf');

const fileInputName = 'qqfile';
const chunkDirName = settings.chunkDirName;
const maxFileSize = settings.maxFileSize;

let uploadedFilesPath = 'files/';

module.exports = function (req, res) {
  const form = new multiparty.Form();

  uploadedFilesPath = settings.defaultFolder + (req.query.parentPath || '') + '/';

  console.log('Upload folder: ' + uploadedFilesPath);

  form.parse(req, function (err, fields, files) {
    const partIndex = fields.qqpartindex;

    // text/plain is required to ensure support for IE9 and older
    res.set('Content-Type', 'text/plain');

    console.log('Simple Upload: ' + (partIndex == null));

    if (partIndex == null) {
      onSimpleUpload(fields, files[fileInputName][0], res);
    } else {
      onChunkedUpload(fields, files[fileInputName][0], res);
    }
  });
};

function onSimpleUpload(fields, file, res) {
  const uuid = fields.qquuid,
    responseData = {
      success: false
    };

  // file.name = fields.qqfilename;
  file.name = file.originalFilename;

  if (isValid(file.size)) {
    moveUploadedFile(file, uuid, function () {
        responseData.success = true;
        res.send(responseData);
      },
      function () {
        responseData.error = 'Problem copying the file!';
        res.send(responseData);
      });
  } else {
    failWithTooBigFile(responseData, res);
  }
}

function onChunkedUpload(fields, file, res) {
  const size = parseInt(fields.qqtotalfilesize),
    uuid = fields.qquuid,
    index = fields.qqpartindex,
    totalParts = parseInt(fields.qqtotalparts),
    responseData = {
      success: false
    };

  // file.name = fields.qqfilename;
  file.name = file.originalFilename;

  if (isValid(size)) {
    storeChunk(file, uuid, index, totalParts, function () {
        if (index < totalParts - 1) {
          responseData.success = true;
          res.send(responseData);
        } else {
          combineChunks(file, uuid, function () {
              responseData.success = true;
              res.send(responseData);
            },
            function () {
              responseData.error = 'Problem conbining the chunks!';
              res.send(responseData);
            });
        }
      },
      function (reset) {
        responseData.error = 'Problem storing the chunk!';
        res.send(responseData);
      });
  } else {
    failWithTooBigFile(responseData, res);
  }
}

function failWithTooBigFile(responseData, res) {
  responseData.error = 'Too big!';
  responseData.preventRetry = true;
  res.send(responseData);
}

function isValid(size) {
  return maxFileSize === 0 || size < maxFileSize;
}

function moveFile(destinationDir, sourceFile, destinationFile, success, failure) {
  mkdirp(destinationDir, function (error) {
    let sourceStream, destStream;

    if (error) {
      console.error('Problem creating directory ' + destinationDir + ': ' + error);
      failure();
    } else {
      console.log('dest file ' + destinationFile);

      sourceStream = fs.createReadStream(sourceFile);
      destStream = fs.createWriteStream(destinationFile);

      sourceStream
        .on('error', function (error) {
          console.error('Problem copying file: ' + error.stack);
          destStream.end();
          failure();
        })
        .on('end', function () {
          destStream.end();
          success();
        })
        .pipe(destStream);
    }
  });
}

function moveUploadedFile(file, uuid, success, failure) {
  console.log(uuid);
  console.log(file);

  const destinationDir = uploadedFilesPath + uuid + '/',
    fileDestination = uploadedFilesPath + file.name;

  moveFile(destinationDir, file.path, fileDestination, success, failure);
}

function storeChunk(file, uuid, index, numChunks, success, failure) {
  const destinationDir = uploadedFilesPath + uuid + '/' + chunkDirName + '/',
    chunkFilename = getChunkFilename(index, numChunks),
    fileDestination = destinationDir + chunkFilename;

  moveFile(destinationDir, file.path, fileDestination, success, failure);
}

function combineChunks(file, uuid, success, failure) {
  const chunksDir = uploadedFilesPath + uuid + '/' + chunkDirName + '/',
    destinationDir = uploadedFilesPath + uuid + '/',
    fileDestination = uploadedFilesPath + file.name;


  fs.readdir(chunksDir, function (err, fileNames) {
    let destFileStream;

    if (err) {
      console.error('Problem listing chunks! ' + err);
      failure();
    } else {
      fileNames.sort();
      destFileStream = fs.createWriteStream(fileDestination, {flags: 'a'});

      appendToStream(destFileStream, chunksDir, fileNames, 0, function () {
          rimraf(chunksDir, function (rimrafError) {
            if (rimrafError) {
              console.log('Problem deleting chunks dir! ' + rimrafError);
            }
          });
          success();
        },
        failure);
    }
  });
}

function appendToStream(destStream, srcDir, srcFilesnames, index, success, failure) {
  console.log('appendToStream: ', arguments);

  if (index < srcFilesnames.length) {
    fs.createReadStream(srcDir + srcFilesnames[index])
      .on('end', function () {
        appendToStream(destStream, srcDir, srcFilesnames, index + 1, success, failure);
      })
      .on('error', function (error) {
        console.error('Problem appending chunk! ' + error);
        destStream.end();
        failure();
      })
      .pipe(destStream, {end: false});
  } else {
    destStream.end();
    success();
  }
}

function getChunkFilename(index, count) {
  const digits = String(count).length,
    zeros = new Array(digits + 1).join('0');

  return (zeros + index).slice(-digits);
}
