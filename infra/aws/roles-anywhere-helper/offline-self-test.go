// Offline verification driver for the unchanged AWS helper CLI. Synthetic keys
// live only in the container's /tmp tmpfs; OpenSSL independently checks signatures.
package main

import (
	"bytes"
	"context"
	"crypto"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"encoding/pem"
	"fmt"
	"math/big"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

const helper = "/out/aws_signing_helper"
const version = "1.8.5+applypack.1"

func require(ok bool, message string) { if !ok { panic(message) } }
func checked(err error) { if err != nil { panic(err) } }
func command(name string, args ...string) ([]byte, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, name, args...)
	cmd.Env = []string{"PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin", "HOME=/tmp", "LANG=C", "LC_ALL=C", "TZ=UTC"}
	return cmd.CombinedOutput()
}
func success(name string, args ...string) []byte {
	output, err := command(name, args...)
	if err != nil { panic(fmt.Sprintf("command failed: %s %v: %v: %s", name, args, err, output)) }
	return output
}
func write(path string, content []byte, mode os.FileMode) { checked(os.WriteFile(path, content, mode)) }

func verifySigner(directory, name string, key crypto.Signer) int {
	keyDER, err := x509.MarshalPKCS8PrivateKey(key); checked(err)
	keyPath := filepath.Join(directory, name+"-key.pem")
	write(keyPath, pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: keyDER}), 0600)
	now := time.Now()
	template := &x509.Certificate{SerialNumber: big.NewInt(1), Subject: pkix.Name{CommonName: "ApplyPack offline synthetic helper test"}, NotBefore: now.Add(-time.Minute), NotAfter: now.Add(time.Hour), KeyUsage: x509.KeyUsageDigitalSignature}
	certDER, err := x509.CreateCertificate(rand.Reader, template, template, key.Public(), key); checked(err)
	certPath := filepath.Join(directory, name+"-cert.pem")
	write(certPath, pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: certDER}), 0600)
	certOutput := success(helper, "read-certificate-data", "--certificate", certPath)
	var certificateData struct {
		KeyType string `json:"keyType"`
		DER string `json:"certificateData"`
		Serial string `json:"serialNumber"`
	}
	checked(json.Unmarshal(certOutput, &certificateData))
	returnedDER, err := base64.StdEncoding.DecodeString(certificateData.DER); checked(err)
	expectedType := "RSA"; if name == "ecdsa" { expectedType = "EC" }
	require(bytes.Equal(returnedDER, certDER) && certificateData.Serial == "1" && certificateData.KeyType == expectedType, "certificate identity mismatch")
	publicDER, err := x509.MarshalPKIXPublicKey(key.Public()); checked(err)
	publicPath := filepath.Join(directory, name+"-public.pem")
	write(publicPath, pem.EncodeToMemory(&pem.Block{Type: "PUBLIC KEY", Bytes: publicDER}), 0600)
	var publicBytes []byte
	switch public := key.Public().(type) {
	case *rsa.PublicKey: publicBytes = x509.MarshalPKCS1PublicKey(public)
	case *ecdsa.PublicKey: publicBytes = elliptic.Marshal(public.Curve, public.X, public.Y)
	default: panic("unexpected key type")
	}
	suffix := sha256.Sum256(append([]byte("IAM RA"), publicBytes...))
	message := append([]byte("AWS Roles Anywhere Credential Helper Signing Test1"), suffix[:]...)
	messagePath := filepath.Join(directory, name+"-message.bin")
	write(messagePath, message, 0600)
	badMessage := append([]byte{}, message...); badMessage[0] ^= 1
	badPath := filepath.Join(directory, name+"-changed.bin")
	write(badPath, badMessage, 0600)
	checks := 1
	for _, digest := range []string{"SHA256", "SHA384", "SHA512"} {
		signature := success(helper, "sign-string", "--private-key", keyPath, "--certificate", certPath, "--format", "bin", "--digest", digest)
		signaturePath := filepath.Join(directory, name+"-"+digest+".sig")
		write(signaturePath, signature, 0600)
		args := []string{"dgst", "-"+strings.ToLower(digest), "-verify", publicPath, "-signature", signaturePath, messagePath}
		output := success("openssl", args...)
		require(bytes.Contains(output, []byte("Verified OK")), "signature not verified")
		args[len(args)-1] = badPath
		_, err := command("openssl", args...)
		require(err != nil, "changed message accepted")
		checks += 2
	}
	return checks
}

func main() {
	require(os.Geteuid() != 0, "self-test requires non-root UID")
	data, err := os.ReadFile(helper); checked(err)
	digest := sha256.Sum256(data)
	require(strings.TrimSpace(string(success(helper, "version"))) == version, "version mismatch")
	help := success(helper, "--help")
	checks := 2
	for _, subcommand := range []string{"credential-process", "update", "serve", "sign-string", "read-certificate-data", "version"} {
		require(bytes.Contains(help, []byte(subcommand)), "missing command: "+subcommand)
		success(helper, subcommand, "--help")
		checks++
	}
	directory, err := os.MkdirTemp("/tmp", "applypack-helper-synthetic-"); checked(err)
	defer os.RemoveAll(directory)
	rsaKey, err := rsa.GenerateKey(rand.Reader, 2048); checked(err)
	ecKey, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader); checked(err)
	checks += verifySigner(directory, "rsa", rsaKey)
	checks += verifySigner(directory, "ecdsa", ecKey)
	result := map[string]any{"status": "PASS", "version": version, "binarySha256": hex.EncodeToString(digest[:]), "checks": checks, "signatureVerifier": "OpenSSL", "rsaBits": 2048, "ecdsaCurve": "P-256", "digestAlgorithms": []string{"SHA256", "SHA384", "SHA512"}, "negativeMessageChecks": 6, "uid": os.Geteuid(), "providerCalls": 0, "syntheticKeysRetained": false}
	checked(json.NewEncoder(os.Stdout).Encode(result))
}
