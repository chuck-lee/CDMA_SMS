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
    "messageClass: " + msg.messageClass + "<br />" +
    "body: " + msg.body;
}

function encoderOutput(msg) {
  document.getElementById("encoderResult").innerHTML = "";
}

function Decode() {
  document.getElementById("decoderResult").innerHTML = "";
  Buf.processIncoming(document.getElementById("smsPDU").value);
  var message = CdmaPDUHelper.readMessage();
  decoderOutput(message);
  return;
}

function Encode() {
  document.getElementById("encoderResult").innerHTML = "";
  var pdu = CdmaPDUHelper.readMessage();
  encoderOutput(pdu);
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
  }
};

/*
 * Basic PDU I/O function for both GSM and CDMA, all read/write operation
 * are applied to Buf directly.
 */
var pduHelper = {
  readCache: 0,
  readCacheSize: 0,
  writeCache: 0,
  writeCacheSize: 0,

  /*
   * Read function
   */
  // Max length is 32 because we use integer as read buffer.
  // All get functions are implemented based on bitwise operation.
  readBits: function readBits(length) {
    if (length <= 0 || length > 32) {
      return null;
    }

    if (length > this.readCacheSize) {
      var bytesToRead = Math.ceil((length - this.readCacheSize) / 8);
      for(var i = 0; i < bytesToRead; i++) {
        this.readCache = (this.readCache << 8) | (Buf.readUint8() & 0xFF);
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

  // Drop what still in buffer and goto next 8-byte alignment.
  nextOctecAlign: function nextOctecAlign() {
    this.readCache = 0;
    this.readCacheSize = 0;
  },

  readHexNibble: function readHexNibble() {
    return this.readBits(4);
  },

  readHexOctet: function readHexOctet() {
    return this.readBits(8);
  },

  readHexOctetArray: function readHexOctetArray(length) {
    var array = new Uint8Array(length);
    for (var i = 0; i < length; i++) {
      array[i] = this.readHexOctet();
    }
    return array;
  },

  /*
   * Write function
   */
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
    var mergeLength = 8 - this.writeCacheSize,
        valueMask = (1 << mergeLength) - 1;

    this.writeCache = (this.writeCache << mergeLength) | (value & valueMask);
    Buf.writeUint8(this.writeCache & 0xFF);
    length -= mergeLength;

    this.writeCache = 0;
    this.writeCacheSize = 0;
    while (length >= 8) {
      length -= 8;
      Buf.writeUint8((value >> length) & 0xFF);
    }

    // Rest part is saved into cache
    this.writeCacheSize = length;
    this.writeCache = value & ((1 << length) - 1);

    return;
  },

  flushWithPadding: function flushWithPadding() {
    Buf.writeUint8(this.writeCache << (8 - this.writeCacheSize));
    this.writeCache = 0;
    this.writeCacheSize = 0;
  },

  writeHexNibble: function writeHexNibble(value) {
    this.writeBits(value, 4);
  },

  writeHexOctet: function writeHexOctet(value) {
    this.writeBits(value, 8);
  },

  /*
   * Common helper function
   */
  BcdDecoder: function BcdDecoder() {
    return pduHelper.readBits(4) * 10 +
            pduHelper.readBits(4);
  },
};

var CdmaPDUHelper = {
  /**
   * Entry point for SMS decoding
   */
  readMessage: function cdmaReadMessage() {
    // SMS message structure, C.S0015-B v2.0
    // Table 3.4-1, 3.4.2.1-1, 3.4.2.2-1, 3.4.2.3-1
    var msg = {
      // P2P:Point-to-Point, BCAST:Broadcast, ACK:Acknowledge
      // MO:Mobile-Originated, MT:Mobile-Termiated
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

    // SMS Type, C.S0015-B v2.0, Table 3.4-1
    msg.smsType = pduHelper.readHexOctet();
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
      var parameterId = pduHelper.readHexOctet();
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
  dtmfChars: " 1234567890*#   ",
  addressDecoder: function addressDecoder(forceNumberMode) {
    // C.S0015-B v2.0, 3.4.3.3
    var digitMode = pduHelper.readBits(1),
        numberMode = forceNumberMode || pduHelper.readBits(1),
        numberType = null,
        numberPlan = null,
        address = "";

    if (digitMode === 1) {
      numberType = pduHelper.readBits(3);
      if (numberMode === 0) {
        numberPlan = pduHelper.readBits(4);
      }
    }

    debug("[addressDecoder]")
    debug(" digitMode: " + digitMode + ", numberMode: " + numberMode +
          ", numberType: " + numberType + ", numberPlan: " + numberPlan);

    var numFields = pduHelper.readBits(8);

    debug("numFields :" + numFields);

    for(var i = 0; i < numFields; i++) {
      var addrDigit = null;
      if (digitMode === 0) {
        // DTMF 4 bit encoding, C.S0005-D, 2.7.1.3.2.4-4
        addrDigit = pduHelper.readBits(4);
        address += this.dtmfChars.charAt(addrDigit);
      } else {
        addrDigit = pduHelper.readBits(8);
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
    var relativeTime = pduHelper.readBits(8);
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
    var length = pduHelper.readHexOctet();

    debug("===== SMS Parameter Decoder =====");
    debug("Parameter: " + parameterIdMap[id] + "(" + id + ")");
    debug("Length: " + length);

    switch(id) {
      case 0: // Teleservice Identify, C.S0015-B v2.0, 3.4.3.1
        if (length !== 2) {
          // Length must be 2
          return;
        }

        msg.tID = pduHelper.readBits(16);
        debug("Value: " + msg.tID);
        break;
      case 1: // Service Category, C.S0015-B v2.0, 3.4.3.2
        if (length !== 2) {
          // Length must be 2
          return;
        }

        msg.category = pduHelper.readBits(16);
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
      case 5: // Originate Subaddress, C.S0015-B v2.0, 3.4.3.4
        // Unsupported
        break;
      case 6: // Bearer Reply Option, C.S0015-B v2.0, 3.4.3.5
        msg.bearerReplyOpt.replySeq = pduHelper.readBits(6);
        debug("Value: " + msg.bearerReplyOpt.replySeq);
        break;
      case 7: // Cause Code, C.S0015-B v2.0, 3.4.3.6
        msg.causeCode.replySeq = pduHelper.readBits(6);
        msg.causeCode.errorClass = pduHelper.readBits(2);
        if (msg.causeCode.errorClass !== 0) {
          msg.causeCode.causeCode = pduHelper.readBits(8);
        }
        break;
      case 8: // Bearer Data, C.S0015-B v2.0, 3.4.3.7, too complex so implement
              // in another decoder
        msg.bearerData = this.smsSubparameterDecoder(length);
        break;
      default:
        break;
    };
    pduHelper.nextOctecAlign();
    return length;
  },

  messageDecode: function messageDecode(encoding, msgSize) {
    var message = "",
        msgDigit = 0;
    while (msgSize >= 0) {
      switch (encoding) {
        case 0: // Octec
          msgDigit = pduHelper.readBits(8);
          message += String.fromCharCode(msgDigit);
          msgSize--;
          break;
        case 1: // IS-91 Extended Protocol Message
          break;
        case 2: // 7-bit ASCII
          msgDigit = pduHelper.readBits(7);
          message += String.fromCharCode(msgDigit);
          msgSize--;
          break;
        case 3: // IA5
          break;
        case 4: // Unicode
          msgDigit = pduHelper.readBits(16);
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
      var id = pduHelper.readBits(8),
          length = pduHelper.readBits(8);

      remainBufSize -= (2 + length);

      debug("~~~~~ SMS Subparameter Decoder ~~~~~");
      debug("Parameter: " + subparameterIdMap[id] + "(" + id + ")");
      debug("Length: " + length);

      switch(id) {
        case 0: // Message Identifier, C.S0015-B v2.0, 4.5.1
          bearerData.msgType = pduHelper.readBits(4);
          bearerData.msgId = pduHelper.readBits(16);
          bearerData.userHeader = pduHelper.readBits(1);
          debug("MSG Type: " + msgTypeMap[bearerData.msgType] + "(" + bearerData.msgType +
               "), MSG ID: " + bearerData.msgId + ", user header: " + bearerData.userHeader);
          break;
        case 1: // User Data, C.S0015-B v2.0, 4.5.2
          bearerData.msgEncoding = pduHelper.readBits(5);
          if (bearerData.msgEncoding === 1 ||
              bearerData.msgEncoding === 10) {
              bearerData.userMsgType = pduHelper.readBits(8);
          }

          debug("MSG Encoding: " + msgEncodingMap[bearerData.msgEncoding] +
               "(" + bearerData.msgEncoding + "), msgType: " + bearerData.userMsgType );

          // Decode message based on encoding
          var numFields = pduHelper.readBits(8);
          debug("Text Length: " + numFields);
          bearerData.message = (bearerData.message || "") + this.messageDecode(bearerData.msgEncoding, numFields);
          debug( "Message: \"" + bearerData.message + "\"");
          break;
        case 2: // User Response Code, C.S0015-B v2.0, 4.5.3
          bearerData.responseCode = pduHelper.readBits(8);
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
          bearerData.priority = pduHelper.readBits(2);
          debug("Value: " + priorityMap[bearerData.priority] + "(" + bearerData.priority + ")" );
          break;
        case 9: // Privacy Indicator, C.S0015-B v2.0, 4.5.10
          bearerData.privacy = pduHelper.readBits(2);
          v("Value: " + privacyMap[bearerData.privacy] + "(" + bearerData.privacy + ")" );
          break;
        case 10: // Reply Option, C.S0015-B v2.0, 4.5.11
          bearerData.userAck = pduHelper.readBits(1);
          bearerData.deliverAck = pduHelper.readBits(1);
          bearerData.readAck = pduHelper.readBits(1);
          bearerData.deliverReport = pduHelper.readBits(1);
          break;
        case 11: // Number of Messages, C.S0015-B v2.0, 4.5.12
          bearerData.msgNum = pduHelper.BcdDecoder(data);
          break;
        case 12: // Alert on Message Delivery, C.S0015-B v2.0, 4.5.13
          bearerData.alertPriority = pduHelper.readBits(2);
          break;
        case 13: // Language Indicator, C.S0015-B v2.0, 4.5.14
          bearerData.languageIndex = pduHelper.readBits(8);
          break;
        case 14: // Callback Number, C.S0015-B v2.0, 4.5.15
          bearerData.callbackNumber = this.addressDecoder(data, 0);
          break;
        case 15: // Message Display Mode, C.S0015-B v2.0, 4.5.16
          bearerData.msgDiplayMode = pduHelper.readBits(2);
          break;
        case 16: // Multiple Encoding User Data, C.S0015-B v2.0, 4.5.17
          // FIXME: Not Tested
          while (true) {
            var msgEncoding = pduHelper.readBits(5),
                numFields = pduHelper.readBits(8);
            if (!msgEncoding) {
              break;
            }

            debug("Multi-part, MSG Encoding: " + msgEncoding + ", numFields: " + numFields );

            bearerData.message = (bearerData.message || "") + this.messageDecode(msgEncoding, numFields);
            debug( "Message: \"" + bearerData.message + "\"");
          }
          break;
        case 17: // Message Deposit Index, C.S0015-B v2.0, 4.5.18
          bearerData.msgDepositIndex = pduHelper.readBits(16);
          break;
        case 20: // Message Status, C.S0015-B v2.0, 4.5.21
          bearerData.msgErrorClass = pduHelper.readBits(2);
          bearerData.msgStatuCode = pduHelper.readBits(6);
          break;
        case 21: // TP-Failure Cause, C.S0015-B v2.0, 4.5.22
          bearerData.tpFailureCause = pduHelper.readBits(8);
          break;
        default:
          // For other unimplemented subparameter, just ignore the data
          break;
      };
      pduHelper.nextOctecAlign();
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
