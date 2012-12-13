/* Copyright 2012 Chuck Lee @ Mozilla Taiwan
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

function decoderOutput(msg) {
  document.getElementById("decoderResult").innerHTML =
    "delivery: " + msg.delivery + "<br />" +
    "deliveryStatus: " + msg.deliveryStatus + "<br />" +
    "sender: " + msg.sender + "<br />" +
    "receiver: " + msg.receiver + "<br />" +
    "timestamp: " + msg.timestamp + "<br />" +
    "messageClass: " + msg.messageClass + "<br />" +
    "body: " + msg.body;
}

function encoderOutput(msg) {
  document.getElementById("encoderResult").innerHTML = msg;
}

function Decode() {
  document.getElementById("debugLog").innerHTML = "";
  document.getElementById("decoderResult").innerHTML = "";
  Buf.processIncoming(document.getElementById("smsPDU").value);
  var message = CdmaPDUHelper.readMessage();
  decoderOutput(message);
  return;
}

function Encode() {
  document.getElementById("debugLog").innerHTML = "";
  document.getElementById("encoderResult").innerHTML = "";
  var options = {};
  options.address = document.getElementById("smsReceiver").value;
  options.body = document.getElementById("smsMessage").value;
  //Auto Detect
  //options.encoding = parseInt(document.getElementById("smsEncoding").options[document.getElementById("smsEncoding").selectedIndex].value, 10);
  options.priority = parseInt(document.getElementById("smsPriority").options[document.getElementById("smsPriority").selectedIndex].value, 10);
  options.timestamp = new Date();
  CdmaPDUHelper.sendSMS(options);
  return;
}

var DEBUG = true;
function debug(msg) {
  if (DEBUG) {
    document.getElementById("debugLog").innerHTML += (msg + "<br />");
  }
}

// Simulate Buf in ril_worker.js
var Buf = {
  incomingBytes: [],
  incomingBytesSize: 0,
  outgoingBytes: [],
  outgoingBytesSize: 0,
  outgoingPosition: [],

  readUint8: function readUint8() {
    return this.incomingBytes.shift();
  },

  readUint8Array: function readUint8Array(length) {
    var subArray = [];
    for(var i = 0; i < length; i++) {
      subArray.push(this.incomingBytes.shift());
    }
    return subArray;
  },

  // It's Little Endian
  readUint16: function readUint16() {
    return this.readUint8() | this.readUint8() << 8;
  },

  readUint32: function readUint32() {
    return this.readUint8()       | this.readUint8() <<  8 |
           this.readUint8() << 16 | this.readUint8() << 24;
  },

  readParcelSize: function readParcelSize() {
    return this.incomingBytesSize;
  },

  processIncoming: function processIncoming(incoming) {
    /*
    for(var i = 0; i < incoming.length; i++) {
      // Real Buf uses 2 bytes to represent 1 char, UNICODE?
      this.incomingBytes.push(incoming.charCodeAt(i));
      this.incomingBytes.push(0);
    }
    //*/
    this.incomingBytes = [];
    this.incomingBytesSize = 0;
    for(var i = 0; i < incoming.length; i+=2) {
      // Real Buf uses 2 bytes to represent 1 char, UNICODE?
      // this.incomingBytes.push(incoming.charCodeAt(i));
      this.incomingBytes.push(parseInt(incoming.substr(i, 2), 16));
    }
    this.incomingBytesSize = this.incomingBytes.length;
  },

  writeUint8: function writeUint8(value) {
    this.outgoingBytes.push(value & 0xFF);
  },

  // Little Endian
  writeUint16: function writeUint16(value) {
    this.writeUint8(value & 0xff);
    this.writeUint8((value >> 8) & 0xff);
  },

  writeUint32: function writeUint32(value) {
    this.writeUint8(value & 0xff);
    this.writeUint8((value >> 8) & 0xff);
    this.writeUint8((value >> 16) & 0xff);
    this.writeUint8((value >> 24) & 0xff);
  },

  newParcel: function newParcel(type, options) {
    this.outgoingBytes = [];
    this.outgoingBytesSize = 0;
    return;
  },

  sendParcel: function sendParcel() {
    var rawData = "";

    this.outgoingBytesSize = this.outgoingBytes.length;
    for (var i = 0; i < this.outgoingBytesSize; i++) {
      var hexString = this.outgoingBytes[i].toString(16);
      rawData += (hexString.length === 1 ? "0" : "") + hexString;
    }

    encoderOutput(rawData);

    this.outgoingBytes = [];
    this.outgoingBytesSize = 0;

    return;
  },

  getCurrentOutgoinPosition: function getCurrentOutgoinPosition() {
    return (this.outgoingBytes.length - 1);
  },

  writeUint8ToPosition: function writeUint8ToPosition(value, position) {
    this.outgoingBytes[position] = value & 0xFF;
  }
};

/*
 * Basic PDU I/O function for both GSM and CDMA, all read/write operation
 * are applied to Buf directly.
 */
var bitBuffer = {
  readCache: 0,
  readCacheSize: 0,
  readBuffer: [],
  readIndex: 0,
  writeCache: 0,
  writeCacheSize: 0,
  writeBuffer: [],

  // Max length is 32 because we use integer as read/write cache.
  // All read/write functions are implemented based on bitwise operation.
  readBits: function readBits(length) {
    if (length <= 0 || length > 32) {
      return null;
    }

    if (length > this.readCacheSize) {
      var bytesToRead = Math.ceil((length - this.readCacheSize) / 8);
      for(var i = 0; i < bytesToRead; i++) {
        this.readCache = (this.readCache << 8) | (this.readBuffer[this.readIndex++] & 0xFF);
        this.readCacheSize += 8;
      }
    }

    var bitOffset = (this.readCacheSize - length),
        resultMask = (1 << length) - 1,
        result = 0;

    result = (this.readCache >> bitOffset) & resultMask;
    this.readCacheSize -= length;

    return result;
  },

  writeBits: function writeBits(value, length) {
    if (length <= 0 || length > 32) {
      return;
    }

    var totalLength = length + this.writeCacheSize;

    // 8-byte cache not full
    if (totalLength < 8) {
      var valueMask = (1 << length) - 1;
      this.writeCache = (this.writeCache << length) | (value & valueMask);
      this.writeCacheSize += length;
      return;
    }

    // Deal with unaligned part
    if (this.writeCacheSize) {
      var mergeLength = 8 - this.writeCacheSize,
          valueMask = (1 << mergeLength) - 1;

      this.writeCache = (this.writeCache << mergeLength) | ((value >> (length - mergeLength)) & valueMask);
      this.writeBuffer.push(this.writeCache & 0xFF);
      length -= mergeLength;
    }

    // Aligned part, just copy
    this.writeCache = 0;
    this.writeCacheSize = 0;
    while (length >= 8) {
      length -= 8;
      this.writeBuffer.push((value >> length) & 0xFF);
    }

    // Rest part is saved into cache
    this.writeCacheSize = length;
    this.writeCache = value & ((1 << length) - 1);

    return;
  },

  // Drop what still in read cache and goto next 8-byte alignment.
  // There might be a better naming.
  nextOctetAlign: function nextOctetAlign() {
    this.readCache = 0;
    this.readCacheSize = 0;
  },

  // Flush current write cache to Buf with padding 0s.
  // There might be a better naming.
  flushWithPadding: function flushWithPadding() {
    if (this.writeCacheSize) {
      this.writeBuffer.push(this.writeCache << (8 - this.writeCacheSize));
    }
    this.writeCache = 0;
    this.writeCacheSize = 0;
  },

  startWrite: function startWrite(dataBuffer) {
    this.writeBuffer = dataBuffer;
    this.writeCache = 0;
    this.writeCacheSize = 0;
  },

  startRead: function startRead(dataBuffer) {
    this.readBuffer = dataBuffer;
    this.readCache = 0;
    this.readCacheSize = 0;
    this.readIndex = 0;
  },

  getWriteBufferSize: function getWriteBufferSize() {
    return this.writeBuffer.length;
  },

  overwriteWriteBuffer: function overwriteWriteBuffer(position, data) {
    var writeLength = data.length;
    if (writeLength + position >= this.writeBuffer.length) {
      writeLength = this.writeBuffer.length - position;
    }
    for (var i = 0; i < writeLength; i++) {
      this.writeBuffer[i] = data[i];
    }
  }
};
var pduHelper = {
  /*
   * Common helper function
   */
  BcdDecoder: function BcdDecoder() {
    return bitBuffer.readBits(4) * 10 +
            bitBuffer.readBits(4);
  },

  BcdEncoder: function BcdEncoder(value) {
    bitBuffer.writeBits((value / 10), 4);
    bitBuffer.writeBits((value % 10), 4);
  }
};

/*
 * CDMA SMS Parameter Chart
 * Mandatory is implemented first, then common optional, then others
 *
 * P2P:Point-to-Point
 * BCAST:Broadcast
 * ACK:Acknowledge
 *
 * MO:Mobile-Originated(Sender)
 * MT:Mobile-Termiated(Receiver)
 *
 * M:Mandatory, O:Optional, X:Unavailable
 *
 *                       P2P-MO   P2P-MT   BCAST   ACK-MO   ACK-MT
 * Teleservice ID           M        M       X        X        X
 * Service Category         O        O       M        X        X
 * Originating Address      X        M       X        X        X
 * Originating Subaddress   X        O       X        X        X
 * Destination Address      M        X       X        M        X
 * Destination Subaddress   O        X       X        O        O
 * Bearer Reply Option      O        O       X        X        X
 * Cause codes              X        X       X        M        M
 * Beaer Data               O        O       O        X        X
 */

/*
 * CDMA SMS Teleservice-Subparameter Chart
 * Mandatory is implemented first, then common optional, then others
 *
 * BCAST:Broadcast
 * CMT-91:IS-91 Extended Protocol Enhanced Services
 * WPT:Wireless Paging Teleservice
 * WMT:Wireless Messaging Teleservice
 * VMN:Voice Mail Notification
 * WAP:Wireless Application Protocol
 * WEMT:Wireless Enhanced Messaging Teleservice
 * SCPT:Service Category Programming Teleservice
 * CATPT:Card Application Toolkit Protocol Teleservice
 *
 * MO:Mobile-Originated(Sender)
 * MT:Mobile-Termiated(Receiver)
 * ACK:Acknowledge
 *
 * M:Mandatory, O:Optional, X:Unavailable, C:Conditional
 *
 *                                    BCAST  CMT-91  WPT  WPT  WMT  WMT
 *                                      MT     MT     MT   MO   MT   MO
 * Message Identifier                   M       M     M    M    M    M
 * User Data                            O       M     O    O    O    O
 * Message Center Time Stamp            O       X     O    X    O    O
 * Validity Period - Absolute           O       X     X    X    O    O
 * Validity Period - Relative           O       X     X    X    O    O
 * Deferred Delivery Time - Absolute    X       X     X    X    X    X
 * Deferred Delivery Time - Relative    X       X     X    X    X    X
 * Priority Indicator                   O       X     O    O    O    O
 * Privacy Indicator                    X       X     O    O    O    O
 * Reply Option                         X       X     O    O    O    O
 * Number of Messages                   X       X     O    X    O    O
 * Alert on Message Delivery            O       X     X    X    O    O
 * Language Indicator                   O       X     X    X    O    O
 * Call-Back Number                     O       X     O    O    O    O
 * Message Display Mode                 O       X     O    X    O    O
 * Multiple Encoding User Data          O       X     O    O    O    O
 * Message Deposit Index                X       X     O    O    O    O
 * Service Category Program Data        X       X     X    X    X    X
 * Service Category Program Results     X       X     X    X    X    X
 * Message Status                       X       X     X    X    X    X
 * T-P Failure Cause                    X       X     X    X    X    X
 * Enhanced VMX                         X       X     X    X    X    X
 * Enhanced VMX ACK                     X       X     X    X    X    X
 *
 *
 *                                     VMN  WAP  WAP  WEMT  WEMT  SCPT  SCPT
 *                                      MT   MT   MO   MT    MO    MT    MO
 * Message Identifier                   M    M    M    M     M     M     M
 * User Data                            O    M    M    M     M     X     X
 * Message Center Time Stamp            O    X    X    O     X     O     X
 * Validity Period - Absolute           X    X    X    O     O     X     X
 * Validity Period - Relative           X    X    X    O     O     X     X
 * Deferred Delivery Time - Absolute    X    X    X    X     O     X     X
 * Deferred Delivery Time - Relative    X    X    X    X     O     X     X
 * Priority Indicator                   O    X    X    O     O     X     X
 * Privacy Indicator                    O    X    X    O     O     X     X
 * Reply Option                         X    X    X    O     O     X     X
 * Number of Messages                   M    X    X    O     X     X     X
 * Alert on Message Delivery            X    X    X    O     O     X     X
 * Language Indicator                   X    X    X    O     O     X     X
 * Call-Back Number                     X    X    X    O     O     X     X
 * Message Display Mode                 X    X    X    O     X     X     X
 * Multiple Encoding User Data          O    X    X    O     O     X     X
 * Message Deposit Index                X    X    X    O     O     X     X
 * Service Category Program Data        X    X    X    X     X     M     X
 * Service Category Program Results     X    X    X    X     X     X     M
 * Message Status                       X    X    X    X     X     X     X
 * T-P Failure Cause                    X    X    X    X     X     X     X
 * Enhanced VMX                         O    X    X    X     X     X     X
 * Enhanced VMX ACK                     O    X    X    X     X     X     X
 *
 *
 *                                    CATPT  CATPT   CATPT
 *                                      MT     MO   USER ACK
 * Message Identifier                   M      M       M
 * User Data                            M      M       O
 * User Response Code                   X      X       O
 * Message Center Time Stamp            X      X       X
 * Validity Period - Absolute           X      X       X
 * Validity Period - Relative           X      X       X
 * Deferred Delivery Time - Absolute    X      X       X
 * Deferred Delivery Time - Relative    X      X       X
 * Priority Indicator                   X      X       X
 * Privacy Indicator                    X      X       X
 * Reply Option                         X      X       X
 * Number of Messages                   X      X       X
 * Alert on Message Delivery            X      X       X
 * Language Indicator                   X      X       X
 * Call-Back Number                     X      X       X
 * Message Display Mode                 X      X       X
 * Multiple Encoding User Data          X      X       X
 * Message Deposit Index                X      X       X
 * Service Category Program Data        X      X       X
 * Service Category Program Results     X      X       X
 * Message Status                       X      X       X
 * T-P Failure Cause                    X      X       X
 * Enhanced VMX                         X      X       X
 * Enhanced VMX ACK                     X      X       X
 *
 *
 *                                    SMS    SMS     SMS    SMS     SMS     SMS
 *                                   CANCEL  USER  DELIVER  READ  DELIVER  SUBMIT
 *                                           ACK     ACK    ACK    REPORT  REPORT
 * Message Identifier                  M      M       M      M        M       M
 * User Data                           X      O       O      O        O       O
 * User Response Code                  X      O       X      O        X       X
 * Message Center Time Stamp           X      O       O      X        X       X
 * Validity Period - Absolute          X      X       X      X        X       X
 * Validity Period - Relative          X      X       X      X        X       X
 * Deferred Delivery Time - Absolute   X      X       X      X        X       X
 * Deferred Delivery Time - Relative   X      X       X      X        X       X
 * Priority Indicator                  X      X       X      X        X       X
 * Privacy Indicator                   X      X       X      X        X       X
 * Reply Option                        X      X       X      X        X       X
 * Number of Messages                  X      X       X      X        X       X
 * Alert on Message Delivery           X      X       X      X        X       X
 * Language Indicator                  X      X       X      X        O       O
 * Call-Back Number                    X      X       X      X        X       X
 * Message Display Mode                X      X       X      X        X       X
 * Multiple Encoding User Data         X      O       O      O        O       O
 * Message Deposit Index               X      O       X      O        X       X
 * Service Category Program Data       X      X       X      X        X       X
 * Service Category Program Results    X      X       X      X        X       X
 * Message Status                      X      X       O      X        X       X
 * T-P Failure Cause                   X      X       X      X        C       C
 * Enhanced VMX                        X      X       X      X        X       X
 * Enhanced VMX ACK                    X      X       X      X        X       X
 */

var CdmaPDUHelper = {
  dtmfChars: "D1234567890*#ABC",

  /**
   * Entry point for SMS encoding
   */
  sendSMS: function sendSMS(options) {
    // Deal with some overhead
    Buf.newParcel();

    bitBuffer.startWrite(Buf.outgoingBytes);
    // Encoder
    this.writeMessage(options);

    // Send message
    Buf.sendParcel();
  },

  encodingDetection: function encodingDetection(options) {
    // Try to detect 7-bit ASCII or Unicode
    // FIXME: How to detect others?
    options.encoding = 2; // Default 7-bit ASCII, FIXME: set to system default?
    for (var i = 0; i < options.body.length; i++) {
      var charCode = options.body.charCodeAt(i);
      if (charCode > 0xFF) {
        options.encoding = 4; // Unicode Detected
        break;
      } else if (charCode > 0x7F) {
        options.encoding = 0; // Octet
      }
    }
  },

  writeMessage: function writeMessage(options) {
    this.encodingDetection(options);
    debug("Detected encoding: " + msgEncodingMap[options.encoding] + "(" + options.encoding + ")");

    // Point-to-Point
    bitBuffer.writeBits(0, 8);

    // Teleservice Index : 4098(CDMA Cellular Messaging Teleservice)
    this.smsParameterEncoder(0, 4098);

    // Destination Address
    this.smsParameterEncoder(4, {address: options.address, digitMode: 0, numberMode: 0});

    // Bearer Reply Option
    this.smsParameterEncoder(6, 63 /* FIXME : Message ID*/);

    // Bearer Data
    this.smsParameterEncoder(8, {
      msgId: {type: 2, id: 1},
      msgData: {encoding: options.encoding, body: options.body},
      timestamp: options.timestamp,
      priority: options.priority
    });
  },

  smsParameterEncoder: function smsParameterEncoder(id, data) {
    bitBuffer.writeBits(id, 8);
    switch(id) {
      case 0: // Teleservice Identify, C.S0015-B v2.0, 3.4.3.1
        bitBuffer.writeBits(2, 8);
        bitBuffer.writeBits(data, 16);
        break;
      case 1: // Service Category, C.S0015-B v2.0, 3.4.3.2
        bitBuffer.writeBits(2, 8);
        bitBuffer.writeBits(data, 16);
        break;
      case 2: // Originate Address, C.S0015-B v2.0, 3.4.3.3
        this.addressEncoder(data);
        break;
      case 3: // Originate Subaddress, C.S0015-B v2.0, 3.4.3.4
        // Unsupported
        break;
      case 4: // Destination Address,  C.S0015-B v2.0, 3.4.3.3
        this.addressEncoder(data);
        break;
      case 5: // Destination Subaddress, C.S0015-B v2.0, 3.4.3.4
        // Unsupported
        break;
      case 6: // Bearer Reply Option, C.S0015-B v2.0, 3.4.3.5
        bitBuffer.writeBits(1, 8);
        bitBuffer.writeBits(data, 6);
        bitBuffer.flushWithPadding();
        break;
      case 7: // Cause Code, C.S0015-B v2.0, 3.4.3.6
        if(data.errorClass === 0) {
          bitBuffer.writeBits(1, 8);
        } else {
          bitBuffer.writeBits(2, 8);
        }
        bitBuffer.writeBits(data.replySeq, 6);
        bitBuffer.writeBits(data.errorClass, 2);
        if (data.errorClass !== 0) {
          bitBuffer.writeBits(data.causeCode, 8);
        }
        break;
      case 8: // Bearer Data, C.S0015-B v2.0, 3.4.3.7, too complex so implement
              // in another decoder
        this.smsSubparameterEncoder(data);
        break;
      default:
        break;
    }
  },

  smsSubparameterEncoder: function smsSubparameterEncoder(data) {
    // Reserve one byte for size
    bitBuffer.writeBits(0, 8);
    var lengthPosition = Buf.getCurrentOutgoinPosition();

    for (key in data) {
      var parameter = data[key];
      switch (key) {
        case 'msgId':
          bitBuffer.writeBits(0, 8);
          bitBuffer.writeBits(3, 8);
          bitBuffer.writeBits(parameter.type || 0, 4);
          bitBuffer.writeBits(parameter.id || 0, 16);
          bitBuffer.writeBits(parameter.userHeader || 0, 1);
          // Add padding
          bitBuffer.flushWithPadding();
          break;
        case 'msgData':
          bitBuffer.writeBits(1, 8);
          this.messageEncoder(parameter);
          break;
        case 'timestamp':
          bitBuffer.writeBits(3, 8);
          this.timeStampEncoder(parameter);
          break;
        case 'priority':
          bitBuffer.writeBits(8, 8);
          bitBuffer.writeBits(1, 8);
          bitBuffer.writeBits(parameter, 2);
          // Add padding
          bitBuffer.flushWithPadding();
          break;
      }
    }

    // Calculate data size and refill
    var endPosition = Buf.getCurrentOutgoinPosition(),
        dataSize = endPosition - lengthPosition;
    Buf.writeUint8ToPosition(dataSize, lengthPosition);
  },

  messageEncoder: function messageEncoder(msgData) {
    // Reserve one byte for size
    bitBuffer.writeBits(0, 8);
    var lengthPosition = Buf.getCurrentOutgoinPosition();

    if (!msgData.encoding)
      msgData.encoding = 0;

    bitBuffer.writeBits(msgData.encoding, 5);

    if (msgData.encoding === 1 ||
        msgData.encoding === 10) {
        bitBuffer.writeBits(msgData.type || 0, 8);
    }

    var msgSize = msgData.body.length;
    bitBuffer.writeBits(msgSize, 8);

    for (var i = 0; i < msgSize; i++) {
      switch (msgData.encoding) {
        case 0: // Octec
          var msgDigit = msgData.body.charCodeAt(i);
          bitBuffer.writeBits(msgDigit, 8);
          break;
        case 1: // IS-91 Extended Protocol Message
          break;
        case 2: // 7-bit ASCII
          var msgDigit = msgData.body.charCodeAt(i);
          bitBuffer.writeBits(msgDigit, 7);
          break;
        case 3: // IA5
          break;
        case 4: // Unicode
         var msgDigit = msgData.body.charCodeAt(i);
          bitBuffer.writeBits(msgDigit, 16);
          break;
        case 5: // Shift-6 JIS
          break;
        case 6: // Korean
          break;
        case 7: // Latin/Hebrew
          break;
        case 8: // Latin
          break;
        case 10: // GSM 7-bit default alphabet
          break;
        default:
          break;
      };
    }

    // Add padding
    bitBuffer.flushWithPadding();

    // Calculate data size and refill
    var endPosition = Buf.getCurrentOutgoinPosition(),
        dataSize = endPosition - lengthPosition;
    Buf.writeUint8ToPosition(dataSize, lengthPosition);
  },

  addressEncoder: function addressEncoder(addressInfo) {
    // Reserve one byte for size
    bitBuffer.writeBits(0, 8);
    var lengthPosition = Buf.getCurrentOutgoinPosition();

    // Fill address options
    bitBuffer.writeBits(addressInfo.digitMode, 1);
    if ( addressInfo.numberMode !== null ) {
      bitBuffer.writeBits(addressInfo.numberMode, 1);
    }
    if (addressInfo.digitMode === 1) {
      bitBuffer.writeBits(addressInfo.numberType || 0, 3);
      if (addressInfo.numberMode === 0) {
        bitBuffer.writeBits(addressInfo.numberPlan || 0, 4);
      }
    }

    // Fill address size
    bitBuffer.writeBits(addressInfo.address.length, 8);

    // Fill address
    for (var i = 0; i < addressInfo.address.length; i++) {
      if (addressInfo.digitMode === 1) {
        var addressDigit = addressInfo.address.charCodeAt(i) & 0x7F;
        bitBuffer.writeBits(addressDigit, 8);
      } else {
        var addressDigit = this.dtmfChars.indexOf(addressInfo.address.charAt(i)) || 0;
        bitBuffer.writeBits(addressDigit, 4);
      }
    }

    // Add padding
    bitBuffer.flushWithPadding();

    // Calculate data size and refill
    var endPosition = Buf.getCurrentOutgoinPosition(),
        dataSize = endPosition - lengthPosition;
    Buf.writeUint8ToPosition(dataSize, lengthPosition);
  },

  timeStampEncoder: function timeStampEncoder(timestamp) {
    var year = timestamp.getFullYear(),
        month = timestamp.getMonth(),
        day = timestamp.getDate(),
        hour = timestamp.getHours(),
        min = timestamp.getMinutes(),
        sec = timestamp.getSeconds();

    if (year >= 1996 && year <= 1999) {
      year -= 1900;
    } else {
      year -= 2000;
    }

    bitBuffer.writeBits(6, 8);
    pduHelper.BcdEncoder(year);
    pduHelper.BcdEncoder(month);
    pduHelper.BcdEncoder(day);
    pduHelper.BcdEncoder(hour);
    pduHelper.BcdEncoder(min);
    pduHelper.BcdEncoder(sec);
  },

  /**
   * Entry point for SMS decoding
   */
  readMessage: function cdmaReadMessage() {
    // SMS message structure, C.S0015-B v2.0
    // Table 3.4-1, 3.4.2.1-1, 3.4.2.2-1, 3.4.2.3-1
    var msg = {
      // P2P:Point-to-Point, BCAST:Broadcast, ACK:Acknowledge
      // MO:Mobile-Originated(Sender), MT:Mobile-Termiated(Receiver)
      // M:Mandatory, O:Optional, X:Unavailable
      smsType:        null, // 0:Point-to-Point
                            // 1:Braodcast
                            // 2:Acknowledge

                            // P2P-MO   P2P-MT   BCAST   ACK-MO   ACK-MT
      tID:            null, //    M        M       X        X        X    Teleservice ID
      category:       null, //    O        O       M        X        X    Service Category
      originAddr:     null, //    X        M       X        X        X    Originating Address
      originSubAddr:  null, //    X        O       X        X        X    Originating Subaddress
      destAddr:       null, //    M        X       X        M        X    Destination Address
      destSubAddr:    null, //    O        X       X        O        O    Destination Subaddress
      bearerReplyOpt: {},   //    O        O       X        X        X    Bearer Reply Option
      causeCode:      {},   //    X        X       X        M        M    Cause codes
      bearerData:     {},   //    O        O       O        X        X    Beaer Data
    },
    pduSize = Buf.readParcelSize();

    bitBuffer.startRead(Buf.incomingBytes);

    // SMS Type, C.S0015-B v2.0, Table 3.4-1
    msg.smsType = bitBuffer.readBits(8);
    pduSize--;
    debug("Message Type :" + smsTypeMap[msg.smsType] + "(" + msg.smsType + ")");
    /*
    switch (msg.smsType) {
      case 0:
        // SMS Point-to-Point
        return null;
      case 1:
        // SMS Broadcast
        return null;
      case 2:
        // SMS Acknowledge
        return null
      default:
        return null;
    }
    //*/

    while (pduSize > 0) {
      var parameterId = bitBuffer.readBits(8);
      if (typeof parameterId === 'undefined')
        break;

      pduSize -= (this.smsParameterDecoder(parameterId, msg) + 2);
    }

    // Return same object structure as GSM
    return {delivery: msgTypeMap[msg.bearerData.msgType],
            deliveryStatus: msg.bearerData.responseCode || 0,
            sender: msg.originAddr, // + msg.originSubAddr
            receiver: msg.destAddr, // + msg.destSubAddr
            messageClass: priorityMap[(msg.bearerData.priority || 0)],
            timestamp: msg.bearerData.timestamp,
            body: msg.bearerData.message
            };
  },

  /*
   * forceNumberMode is used to assign numberMode, which only used
   * while decode callback address.
   */
  addressDecoder: function addressDecoder(forceNumberMode) {
    // C.S0015-B v2.0, 3.4.3.3
    var digitMode = bitBuffer.readBits(1),
        numberMode = forceNumberMode || bitBuffer.readBits(1),
        numberType = null,
        numberPlan = null,
        address = "";

    if (digitMode === 1) {
      numberType = bitBuffer.readBits(3);
      if (numberMode === 0) {
        numberPlan = bitBuffer.readBits(4);
      }
    }

    debug("[addressDecoder]")
    debug(" digitMode: " + digitMode + ", numberMode: " + numberMode +
          ", numberType: " + numberType + ", numberPlan: " + numberPlan);

    var numFields = bitBuffer.readBits(8);

    debug("numFields :" + numFields);

    for(var i = 0; i < numFields; i++) {
      var addrDigit = null;
      if (digitMode === 0) {
        // DTMF 4 bit encoding, C.S0005-D, 2.7.1.3.2.4-4
        addrDigit = bitBuffer.readBits(4);
        address += this.dtmfChars.charAt(addrDigit);
      } else {
        addrDigit = bitBuffer.readBits(8);
        if (numberMode === 0) {
          // ASCII represntation with MSB set to 0
          // Just treat as normal ASCII?
          address += String.fromCharCode(addrDigit);
        } else {
          if (numberType === 2) {
            // 8 bit ASCII
            address += String.fromCharCode(addrDigit);
          } else if (numberType === 1) {
            // Binary value of an octet of the address
            // FIXME: I don't known what it means
          }
        }
      }
    }

    debug("Address: " + address);

    return address;
  },

  timeStampDecoder: function timeStampDecoder() {
    var year = pduHelper.BcdDecoder(),
        month = pduHelper.BcdDecoder(),
        day = pduHelper.BcdDecoder(),
        hour = pduHelper.BcdDecoder(),
        min = pduHelper.BcdDecoder(),
        sec = pduHelper.BcdDecoder();

    if (year >= 96 && year <= 99) {
      year += 1900;
    } else {
      year += 2000;
    }

    return new Date(year, month, day, hour, min, sec, 0);
  },

  relativeTimeDecoder: function relativeTimeDecoder() {
    var relativeTime = bitBuffer.readBits(8);
    if (relativeTime === 248) {
      // Valid until registration area changes, discard if not registered
      return -2;
    } else if (relativeTime === 247) {
      // Valid until mobile becomes inactive, Deliver when mobile next becomes active
      return -1;
    } else if (relativeTime == 246) {
      // Immediate
      return 0;
    } else if (relativeTime == 245) {
      // How to represent forever?
      return 99999999999;
    } else if (relativeTime >= 197) {
      // (value - 192) weeks
      return (relativeTime - 192) * 604800;
    } else if (relativeTime >= 168) {
      // (value - 166) days
      return (relativeTime - 166) * 86400;
    } else if (relativeTime >= 144) {
      // 12 hr + (value - 143) * 30 min
      return (relativeTime - 143) * 1800 + 21600;
    }

    // (value + 1) * 5 min
    return (relativeTime + 1) * 300;
  },

  smsParameterDecoder: function(id, msg) {
    var length = bitBuffer.readBits(8);

    debug("===== SMS Parameter Decoder =====");
    debug("Parameter: " + parameterIdMap[id] + "(" + id + ")");
    debug("Length: " + length);

    switch(id) {
      case 0: // Teleservice Identify, C.S0015-B v2.0, 3.4.3.1
        if (length !== 2) {
          // Length must be 2
          return;
        }

        msg.tID = bitBuffer.readBits(16);
        debug("Value: " + msg.tID);
        break;
      case 1: // Service Category, C.S0015-B v2.0, 3.4.3.2
        if (length !== 2) {
          // Length must be 2
          return;
        }

        msg.category = bitBuffer.readBits(16);
        debug("Value: " + msg.category);
        break;
      case 2: // Originate Address, C.S0015-B v2.0, 3.4.3.3
        msg.originAddr = this.addressDecoder(false);
        break;
      case 3: // Originate Subaddress, C.S0015-B v2.0, 3.4.3.4
        // Unsupported
        break;
      case 4: // Destination Address,  C.S0015-B v2.0, 3.4.3.3
        msg.destAddr = this.addressDecoder(false);
        break;
      case 5: // Destination Subaddress, C.S0015-B v2.0, 3.4.3.4
        // Unsupported
        break;
      case 6: // Bearer Reply Option, C.S0015-B v2.0, 3.4.3.5
        msg.bearerReplyOpt.replySeq = bitBuffer.readBits(6);
        debug("Value: " + msg.bearerReplyOpt.replySeq);
        break;
      case 7: // Cause Code, C.S0015-B v2.0, 3.4.3.6
        msg.causeCode.replySeq = bitBuffer.readBits(6);
        msg.causeCode.errorClass = bitBuffer.readBits(2);
        if (msg.causeCode.errorClass !== 0) {
          msg.causeCode.causeCode = bitBuffer.readBits(8);
        }
        break;
      case 8: // Bearer Data, C.S0015-B v2.0, 3.4.3.7, too complex so implement
              // in another decoder
        msg.bearerData = this.smsSubparameterDecoder(length);
        break;
      default:
        break;
    };
    bitBuffer.nextOctetAlign();
    return length;
  },

  messageDecoder: function messageDecoder(encoding, msgSize) {
    var message = "",
        msgDigit = 0;
    while (msgSize > 0) {
      switch (encoding) {
        case 0: // Octec
          msgDigit = bitBuffer.readBits(8);
          message += String.fromCharCode(msgDigit);
          msgSize--;
          break;
        case 1: // IS-91 Extended Protocol Message
          break;
        case 2: // 7-bit ASCII
          msgDigit = bitBuffer.readBits(7);
          message += String.fromCharCode(msgDigit);
          msgSize--;
          break;
        case 3: // IA5
          break;
        case 4: // Unicode
          msgDigit = bitBuffer.readBits(16);
          message += String.fromCharCode(msgDigit);
          msgSize--;
          break;
        case 5: // Shift-6 JIS
          break;
        case 6: // Korean
          break;
        case 7: // Latin/Hebrew
          break;
        case 8: // Latin
          break;
        case 10: // GSM 7-bit default alphabet
          break;
        default:
          break;
      };
    }
    return message;
  },

  smsSubparameterDecoder: function smsSubparameterDecoder(dataBufSize) {
    var bearerData = {},
        remainBufSize = dataBufSize;  // In bytes
    while (remainBufSize > 0) {
      // Fixed header
      var id = bitBuffer.readBits(8),
          length = bitBuffer.readBits(8);

      remainBufSize -= (2 + length);

      debug("~~~~~ SMS Subparameter Decoder ~~~~~");
      debug("Parameter: " + subparameterIdMap[id] + "(" + id + ")");
      debug("Length: " + length);

      switch(id) {
        case 0: // Message Identifier, C.S0015-B v2.0, 4.5.1
          bearerData.msgType = bitBuffer.readBits(4);
          bearerData.msgId = bitBuffer.readBits(16);
          bearerData.userHeader = bitBuffer.readBits(1);
          debug("MSG Type: " + msgTypeMap[bearerData.msgType] + "(" + bearerData.msgType +
               "), MSG ID: " + bearerData.msgId + ", user header: " + bearerData.userHeader);
          break;
        case 1: // User Data, C.S0015-B v2.0, 4.5.2
          bearerData.msgEncoding = bitBuffer.readBits(5);
          if (bearerData.msgEncoding === 1 ||
              bearerData.msgEncoding === 10) {
              bearerData.userMsgType = bitBuffer.readBits(8);
          }

          debug("MSG Encoding: " + msgEncodingMap[bearerData.msgEncoding] +
               "(" + bearerData.msgEncoding + "), msgType: " + bearerData.userMsgType );

          // Decode message based on encoding
          var numFields = bitBuffer.readBits(8);
          debug("Text Length: " + numFields);
          bearerData.message = (bearerData.message || "") + this.messageDecoder(bearerData.msgEncoding, numFields);
          debug( "Message: \"" + bearerData.message + "\"");
          break;
        case 2: // User Response Code, C.S0015-B v2.0, 4.5.3
          bearerData.responseCode = bitBuffer.readBits(8);
          debug("Value: " + bearerData.responseCode);
          break;
        case 3: // Message Center Time Stamp, C.S0015-B v2.0, 4.5.4
          bearerData.timestamp = this.timeStampDecoder();
          debug("Value: " + bearerData.timestamp);
          break;
        case 4: // Validity Period – Absolute, C.S0015-B v2.0, 4.5.5
          bearerData.validityPeriodAbsolute = this.timeStampDecoder();
          debug("Value: " + bearerData.validityPeriodAbsolute);
          break;
        case 5: // Validity Period - Relative, C.S0015-B v2.0, 4.5.6
          // Transform to local time??
          bearerData.validityPeriodRelative = this.relativeTimeDecoder();
          v("Value: " + bearerData.validityPeriodRelative + " seconds");
          break;
        case 6: // Deferred Delivery Time - Absolute, C.S0015-B v2.0, 4.5.7
          bearerData.deliveryTimeAbsolute = this.timeStampDecoder();
          debug("Value: " + bearerData.deliveryTimeAbsolute);
          break;
        case 7: // Deferred Delivery Time - Relative, C.S0015-B v2.0, 4.5.8
          // Transform to local time??
          bearerData.deliveryTimeRelative = this.relativeTimeDecoder();
          debug("Value: " + bearerData.deliveryTimeRelative + " seconds");
          break;
        case 8: // Priority Indicator, C.S0015-B v2.0, 4.5.9
          bearerData.priority = bitBuffer.readBits(2);
          debug("Value: " + priorityMap[bearerData.priority] + "(" + bearerData.priority + ")" );
          break;
        case 9: // Privacy Indicator, C.S0015-B v2.0, 4.5.10
          bearerData.privacy = bitBuffer.readBits(2);
          v("Value: " + privacyMap[bearerData.privacy] + "(" + bearerData.privacy + ")" );
          break;
        case 10: // Reply Option, C.S0015-B v2.0, 4.5.11
          bearerData.userAck = bitBuffer.readBits(1);
          bearerData.deliverAck = bitBuffer.readBits(1);
          bearerData.readAck = bitBuffer.readBits(1);
          bearerData.deliverReport = bitBuffer.readBits(1);
          break;
        case 11: // Number of Messages, C.S0015-B v2.0, 4.5.12
          bearerData.msgNum = pduHelper.BcdDecoder(data);
          break;
        case 12: // Alert on Message Delivery, C.S0015-B v2.0, 4.5.13
          bearerData.alertPriority = bitBuffer.readBits(2);
          break;
        case 13: // Language Indicator, C.S0015-B v2.0, 4.5.14
          bearerData.languageIndex = bitBuffer.readBits(8);
          break;
        case 14: // Callback Number, C.S0015-B v2.0, 4.5.15
          bearerData.callbackNumber = this.addressDecoder(data, 0);
          break;
        case 15: // Message Display Mode, C.S0015-B v2.0, 4.5.16
          bearerData.msgDiplayMode = bitBuffer.readBits(2);
          break;
        case 16: // Multiple Encoding User Data, C.S0015-B v2.0, 4.5.17
          // FIXME: Not Tested
          while (true) {
            var msgEncoding = bitBuffer.readBits(5),
                numFields = bitBuffer.readBits(8);
            if (!msgEncoding) {
              break;
            }

            debug("Multi-part, MSG Encoding: " + msgEncoding + ", numFields: " + numFields );

            bearerData.message = (bearerData.message || "") + this.messageDecoder(msgEncoding, numFields);
            debug( "Message: \"" + bearerData.message + "\"");
          }
          break;
        case 17: // Message Deposit Index, C.S0015-B v2.0, 4.5.18
          bearerData.msgDepositIndex = bitBuffer.readBits(16);
          break;
        case 20: // Message Status, C.S0015-B v2.0, 4.5.21
          bearerData.msgErrorClass = bitBuffer.readBits(2);
          bearerData.msgStatuCode = bitBuffer.readBits(6);
          break;
        case 21: // TP-Failure Cause, C.S0015-B v2.0, 4.5.22
          bearerData.tpFailureCause = bitBuffer.readBits(8);
          break;
        default:
          // For other unimplemented subparameter, just ignore the data
          break;
      };
      bitBuffer.nextOctetAlign();
    }
  return bearerData;
  }
};

// String Mapping
var smsTypeMap = [
  "Point-to-Point",
  "Broadcast",
  "Acknowledge"
];

var priorityMap = [
  "normal",
  "interactive",
  "urgent",
  "emergency"
];

var privacyMap = [
  "Not restricted",
  "Restricted",
  "Confidential",
  "Secret"
];

var msgTypeMap = [
  "Reserved",
  "received", //"Deliver",
  "sent",     //"Submit",
  "Cancellation",
  "Deliever Acknowledge",
  "User Acknowledge",
  "Read Acknowledge",
  "Deliver Report",
  "Submit Report"
];

var parameterIdMap = [
  "Teleservice Identity",
  "Service Category",
  "Originating Address",
  "Originating Subaddress",
  "Destination Address",
  "Destination Subaddress",
  "Bearer Reply Option",
  "Cause Codes",
  "Bearer Data"
];

var subparameterIdMap = [
  "Message Identifier",
  "User Data",
  "User Response Code",
  "Message Center Time Stamp",
  "Validity Period – Absolute",
  "Validity Period – Relative",
  "Deferred Delivery Time – Absolute",
  "Deferred Delivery Time – Relative",
  "Priority Indicator",
  "Privacy Indicator",
  "Reply Option",
  "Number of Messages",
  "Alert on Message Delivery",
  "Language Indicator",
  "Call-Back Number",
  "Message Display Mode",
  "Multiple Encoding User Data",
  "Message Deposit Index",
  "Service Category Program Data",
  "Service Category Program Results",
  "Message Status",
  "TP-Failure Cause",
  "Enhanced VMN",
  "Enhanced VMN Ack"
];

var msgEncodingMap = [
  "Octet",
  "IS-91 Extended Protocol Message",
  "7-bit ASCII",
  "IA5",
  "UNICODE",
  "Shift-6 JIS",
  "Korean",
  "Latin/ Hebrew",
  "Latin",
  "GSM 7-bit default alphabet"
];

var GSM_7_BIT_DEFAULT_ALPHABET_TABLE =
  // 01.....23.....4.....5.....6.....7.....8.....9.....A.B.....C.....D.E.....F.....
    "@\u00a3$\u00a5\u00e8\u00e9\u00f9\u00ec\u00f2\u00c7\n\u00d8\u00f8\r\u00c5\u00e5"
  // 0.....12.....3.....4.....5.....6.....7.....8.....9.....A.....B.....C.....D.....E.....F.....
  + "\u0394_\u03a6\u0393\u039b\u03a9\u03a0\u03a8\u03a3\u0398\u039e\uffff\u00c6\u00e6\u00df\u00c9"
  // 012.34.....56789ABCDEF
  + " !\"#\u00a4%&'()*+,-./"
  // 0123456789ABCDEF
  + "0123456789:;<=>?"
  // 0.....123456789ABCDEF
  + "\u00a1ABCDEFGHIJKLMNO"
  // 0123456789AB.....C.....D.....E.....F.....
  + "PQRSTUVWXYZ\u00c4\u00d6\u00d1\u00dc\u00a7"
  // 0.....123456789ABCDEF
  + "\u00bfabcdefghijklmno"
  // 0123456789AB.....C.....D.....E.....F.....
  + "pqrstuvwxyz\u00e4\u00f6\u00f1\u00fc\u00e0";