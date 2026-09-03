package chat

import (
	"bytes"
	"encoding/hex"
	"errors"
	"testing"
)

func TestTokenCipherRoundTrip(t *testing.T) {
	cipher, err := NewTokenCipher("chat-secret")
	if err != nil {
		t.Fatal(err)
	}
	encrypted, err := cipher.Encrypt("provider-token")
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(encrypted, []byte("provider-token")) {
		t.Fatal("encrypted token contains plaintext")
	}
	decrypted, err := cipher.Decrypt(encrypted)
	if err != nil || decrypted != "provider-token" {
		t.Fatalf("Decrypt() = %q, %v", decrypted, err)
	}
}

func TestTokenCipherRejectsAnotherSecret(t *testing.T) {
	first, _ := NewTokenCipher("first-secret")
	second, _ := NewTokenCipher("second-secret")
	encrypted, err := first.Encrypt("provider-token")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := second.Decrypt(encrypted); !errors.Is(err, ErrTokenDecryption) {
		t.Fatalf("expected token decryption failure, got %v", err)
	}
}

func TestTokenCipherDecryptsTypeScriptFixture(t *testing.T) {
	cipher, err := NewTokenCipher("chat-secret")
	if err != nil {
		t.Fatal(err)
	}
	fixture, err := hex.DecodeString("01000102030405060708090a0b9e11518db4acd421195fca5be9a301601ec2a3f5af0d39788eb02191a589")
	if err != nil {
		t.Fatal(err)
	}
	decrypted, err := cipher.Decrypt(fixture)
	if err != nil || decrypted != "provider-token" {
		t.Fatalf("failed to decrypt TypeScript envelope: value=%q err=%v", decrypted, err)
	}
}
