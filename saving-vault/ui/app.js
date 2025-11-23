// NOTE: This file focuses on front-end behavior and *how* we would
// talk to the Saving Vault contract. The actual blockchain calls are left
// as mocked payloads so you can plug in @stacks/transactions + a wallet
// of your choice when you deploy.

const CONTRACT_NAME = "saving-vault";
// On devnet with Clarinet, the contract id would typically be:
// `${deployerAddress}.${CONTRACT_NAME}`

let activeAddress = "";

function $(id) {
  return document.getElementById(id);
}

function bytesToHex(bytes) {
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function hashPhraseToVoiceBytes(phrase) {
  const data = new TextEncoder().encode(phrase);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return new Uint8Array(digest); // 32 bytes
}

function showJson(el, obj) {
  el.textContent = JSON.stringify(obj, null, 2);
}

function ensureAddress() {
  if (!activeAddress) {
    throw new Error("Set an active Stacks address first.");
  }
}

// --- Mock builders for contract calls -------------------------------------

function buildRegisterVoiceTx(voiceBytes) {
  ensureAddress();
  return {
    contract: CONTRACT_NAME,
    function: "register-voice",
    sender: activeAddress,
    args: {
      "voice-hash": bytesToHex(voiceBytes),
    },
  };
}

function buildUpdateVoiceTx(oldBytes, newBytes) {
  ensureAddress();
  return {
    contract: CONTRACT_NAME,
    function: "update-voice",
    sender: activeAddress,
    args: {
      "old-voice-hash": bytesToHex(oldBytes),
      "new-voice-hash": bytesToHex(newBytes),
    },
  };
}

function buildAddVaultItemTx({ uri, mediaType, label, voiceBytes }) {
  ensureAddress();
  return {
    contract: CONTRACT_NAME,
    function: "add-vault-item",
    sender: activeAddress,
    args: {
      uri,
      "media-type": mediaType,
      label,
      "voice-hash": bytesToHex(voiceBytes),
    },
  };
}

function buildRevokeItemTx({ id, voiceBytes }) {
  ensureAddress();
  return {
    contract: CONTRACT_NAME,
    function: "revoke-vault-item",
    sender: activeAddress,
    args: {
      id,
      "voice-hash": bytesToHex(voiceBytes),
    },
  };
}

function buildTransferItemTx({ id, recipient, voiceBytes }) {
  ensureAddress();
  return {
    contract: CONTRACT_NAME,
    function: "transfer-vault-item",
    sender: activeAddress,
    args: {
      id,
      recipient,
      "voice-hash": bytesToHex(voiceBytes),
    },
  };
}

function buildReadOnlyVaultItem(id) {
  ensureAddress();
  return {
    contract: CONTRACT_NAME,
    function: "get-vault-item",
    sender: activeAddress,
    args: { id },
  };
}

// In a real app, instead of returning JSON we would use @stacks/transactions
// makeContractCall() + @stacks/connect to show a wallet popup, e.g.
//
// const tx = await makeContractCall({
//   contractAddress: DEPLOYER_ADDRESS,
//   contractName: "saving-vault",
//   functionName: "add-vault-item",
//   functionArgs: [
//     stringAsciiCV(uri),
//     stringAsciiCV(mediaType),
//     stringAsciiCV(label),
//     bufferCV(voiceBytes),
//   ],
//   ...
// });

// --- DOM wiring ------------------------------------------------------------

window.addEventListener("DOMContentLoaded", () => {
  // Wallet mock
  $("wallet-form").addEventListener("submit", (evt) => {
    evt.preventDefault();
    const addr = $("wallet-address").value.trim();
    if (!addr) return;
    activeAddress = addr;
    $("wallet-status").textContent = `Active address set to ${addr}`;
  });

  // Register voice
  $("voice-register-form").addEventListener("submit", async (evt) => {
    evt.preventDefault();
    try {
      const phrase = $("voice-phrase").value.trim();
      if (!phrase) return;
      const voiceBytes = await hashPhraseToVoiceBytes(phrase);
      const tx = buildRegisterVoiceTx(voiceBytes);
      $("voice-hash-preview").textContent =
        `Derived voice hash (SHA-256, hex):\n${bytesToHex(voiceBytes)}\n\nMock contract call payload:\n` +
        JSON.stringify(tx, null, 2);
    } catch (err) {
      $("voice-hash-preview").textContent = String(err);
    }
  });

  // Update voice
  $("voice-update-form").addEventListener("submit", async (evt) => {
    evt.preventDefault();
    try {
      const oldPhrase = $("old-voice-phrase").value.trim();
      const newPhrase = $("new-voice-phrase").value.trim();
      if (!oldPhrase || !newPhrase) return;
      const oldBytes = await hashPhraseToVoiceBytes(oldPhrase);
      const newBytes = await hashPhraseToVoiceBytes(newPhrase);
      const tx = buildUpdateVoiceTx(oldBytes, newBytes);
      showJson($("voice-hash-preview"), tx);
    } catch (err) {
      $("voice-hash-preview").textContent = String(err);
    }
  });

  // Add item
  $("add-item-form").addEventListener("submit", async (evt) => {
    evt.preventDefault();
    try {
      const uri = $("item-uri").value.trim();
      const mediaType = $("item-media-type").value.trim();
      const label = $("item-label").value.trim();
      const phrase = $("item-voice-phrase").value.trim();
      if (!uri || !mediaType || !label || !phrase) return;
      const voiceBytes = await hashPhraseToVoiceBytes(phrase);
      const tx = buildAddVaultItemTx({ uri, mediaType, label, voiceBytes });
      showJson($("add-item-preview"), tx);
    } catch (err) {
      $("add-item-preview").textContent = String(err);
    }
  });

  // Lookup read-only
  $("lookup-form").addEventListener("submit", (evt) => {
    evt.preventDefault();
    try {
      const id = Number($("lookup-id").value);
      const payload = buildReadOnlyVaultItem(id);
      showJson($("lookup-result"), payload);
    } catch (err) {
      $("lookup-result").textContent = String(err);
    }
  });

  // Revoke
  $("revoke-form").addEventListener("submit", async (evt) => {
    evt.preventDefault();
    try {
      const id = Number($("revoke-id").value);
      const phrase = $("revoke-voice-phrase").value.trim();
      if (!phrase) return;
      const voiceBytes = await hashPhraseToVoiceBytes(phrase);
      const tx = buildRevokeItemTx({ id, voiceBytes });
      showJson($("manage-preview"), tx);
    } catch (err) {
      $("manage-preview").textContent = String(err);
    }
  });

  // Transfer
  $("transfer-form").addEventListener("submit", async (evt) => {
    evt.preventDefault();
    try {
      const id = Number($("transfer-id").value);
      const recipient = $("transfer-recipient").value.trim();
      const phrase = $("transfer-voice-phrase").value.trim();
      if (!recipient || !phrase) return;
      const voiceBytes = await hashPhraseToVoiceBytes(phrase);
      const tx = buildTransferItemTx({ id, recipient, voiceBytes });
      showJson($("manage-preview"), tx);
    } catch (err) {
      $("manage-preview").textContent = String(err);
    }
  });
});
