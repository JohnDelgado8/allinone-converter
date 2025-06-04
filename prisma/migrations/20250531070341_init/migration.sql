-- CreateTable
CREATE TABLE "ConversionLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "originalFileName" TEXT NOT NULL,
    "originalFormat" TEXT NOT NULL,
    "targetFormat" TEXT NOT NULL,
    "userId" TEXT
);
