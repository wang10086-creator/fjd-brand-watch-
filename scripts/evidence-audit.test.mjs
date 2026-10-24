import test from 'node:test';import assert from 'node:assert/strict';
import {generateKeyPairSync,privateDecrypt,createDecipheriv,constants} from 'node:crypto';
import {recipientEnvelope,auditEvidence} from '../cloud/evidence-audit.mjs';
test('audit artifact is encrypted to authorized recipient, never plaintext proof',()=>{
 const {publicKey,privateKey}=generateKeyPairSync('rsa',{modulusLength:3072}),value={png:'private-evidence',previewToken:'private-grant'};
 const e=recipientEnvelope(value,publicKey.export({type:'spki',format:'pem'}));assert.ok(!JSON.stringify(e).includes('private-grant'));
 const key=privateDecrypt({key:privateKey,padding:constants.RSA_PKCS1_OAEP_PADDING,oaepHash:'sha256'},Buffer.from(e.key,'base64')),d=createDecipheriv('aes-256-gcm',key,Buffer.from(e.iv,'base64'));d.setAAD(Buffer.from(e.format));d.setAuthTag(Buffer.from(e.tag,'base64'));assert.deepEqual(JSON.parse(Buffer.concat([d.update(Buffer.from(e.ciphertext,'base64')),d.final()])),value);
});
test('audit rejects unknown or unapproved source before reading private proof',async()=>{
 const read=()=>{throw Error('must not read')};await assert.rejects(auditEvidence({ids:['../../vault'],read}));await assert.rejects(auditEvidence({ids:['lead-'+'a'.repeat(64)],read,feed:{rows:[],monitor:{reviews:[]}}}),/Existing lead missing/);
});
