ALTER TABLE "Patient"
  ADD COLUMN "birthDateEncrypted" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "sexEncrypted" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "bloodGroupEncrypted" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "emergencyContactNameEncrypted" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "emergencyContactPhoneEncrypted" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "addressEncrypted" TEXT NOT NULL DEFAULT '';

ALTER TABLE "MedicalRecord"
  ADD COLUMN "signedAt" TIMESTAMP(3),
  ADD COLUMN "signatureDigest" TEXT NOT NULL DEFAULT '';

ALTER TABLE "Prescription"
  ADD COLUMN "signedAt" TIMESTAMP(3),
  ADD COLUMN "signatureDigest" TEXT NOT NULL DEFAULT '';

CREATE TABLE "ClinicalAttachment" (
  "id" SERIAL NOT NULL,
  "hospitalId" INTEGER NOT NULL,
  "recordId" INTEGER NOT NULL,
  "uploadedById" INTEGER NOT NULL,
  "originalName" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "sizeBytes" INTEGER NOT NULL,
  "encryptedContents" BYTEA NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ClinicalAttachment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ClinicalAttachment_hospitalId_recordId_createdAt_idx"
  ON "ClinicalAttachment"("hospitalId", "recordId", "createdAt");

ALTER TABLE "ClinicalAttachment"
  ADD CONSTRAINT "ClinicalAttachment_hospitalId_fkey"
  FOREIGN KEY ("hospitalId") REFERENCES "Hospital"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "ClinicalAttachment_recordId_fkey"
  FOREIGN KEY ("recordId") REFERENCES "MedicalRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "ClinicalAttachment_uploadedById_fkey"
  FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
