package chat

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"errors"
	"fmt"
)

const tokenEnvelopeVersion byte = 1

var ErrTokenDecryption = errors.New("token decryption failed")

type TokenCipher struct{ aead cipher.AEAD }

func NewTokenCipher(secret string) (*TokenCipher, error) {
	key := sha256.Sum256([]byte(secret))
	block, err := aes.NewCipher(key[:])
	if err != nil {
		return nil, err
	}
	aead, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	return &TokenCipher{aead: aead}, nil
}

func (tokenCipher *TokenCipher) Encrypt(value string) ([]byte, error) {
	nonce := make([]byte, tokenCipher.aead.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return nil, err
	}
	sealed := tokenCipher.aead.Seal(nil, nonce, []byte(value), nil)
	tagStart := len(sealed) - tokenCipher.aead.Overhead()
	envelope := make([]byte, 0, 1+len(nonce)+len(sealed))
	envelope = append(envelope, tokenEnvelopeVersion)
	envelope = append(envelope, nonce...)
	envelope = append(envelope, sealed[tagStart:]...)
	envelope = append(envelope, sealed[:tagStart]...)
	return envelope, nil
}

func (tokenCipher *TokenCipher) Decrypt(envelope []byte) (string, error) {
	nonceSize := tokenCipher.aead.NonceSize()
	tagSize := tokenCipher.aead.Overhead()
	if len(envelope) < 1+nonceSize+tagSize || envelope[0] != tokenEnvelopeVersion {
		return "", ErrTokenDecryption
	}
	nonce := envelope[1 : 1+nonceSize]
	tag := envelope[1+nonceSize : 1+nonceSize+tagSize]
	ciphertext := envelope[1+nonceSize+tagSize:]
	sealed := append(append(make([]byte, 0, len(ciphertext)+len(tag)), ciphertext...), tag...)
	plaintext, err := tokenCipher.aead.Open(nil, nonce, sealed, nil)
	if err != nil || len(plaintext) == 0 {
		return "", fmt.Errorf("%w: %v", ErrTokenDecryption, err)
	}
	return string(plaintext), nil
}
