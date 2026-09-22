// Ephemeral synthetic source keys. Never exported to a deployment or environment.
import { generateKeyPairSync, sign } from "node:crypto";
import { SourceVerifier, sourceSigningPayload, type EvidenceClaim } from "../services/sourceVerification";
const keys = generateKeyPairSync("ed25519");
export const fixtureVerifier = new SourceVerifier(["billing", "crm", "product", "external"].map((sourceSystem) => ({
  keyId: `SYNTHETIC-${sourceSystem}`, sourceSystem, publicKey: keys.publicKey.export({ type: "spki", format: "pem" }).toString(),
})));
export function attestFixture<T extends EvidenceClaim>(caseId: string, claim: T) {
  const issuedAt = new Date().toISOString();
  if (!["billing", "crm", "product", "external"].includes(claim.sourceSystem)) return claim;
  return { ...claim, sourceAttestation: { keyId: `SYNTHETIC-${claim.sourceSystem}`, issuedAt,
    signature: sign(null, sourceSigningPayload(caseId, claim, issuedAt), keys.privateKey).toString("base64") } };
}
