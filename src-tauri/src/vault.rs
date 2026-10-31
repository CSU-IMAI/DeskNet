use crate::models::{EncryptedFileMeta, VaultSettings};
use crate::util::now_ms;
use aes_gcm::aead::{Aead, KeyInit, Payload};
use aes_gcm::{Aes256Gcm, Nonce};
use argon2::{Algorithm, Argon2, Params, Version};
use flate2::write::{DeflateDecoder, DeflateEncoder};
use flate2::Compression;
use hmac::{Hmac, Mac};
use rand::rngs::OsRng;
use rand::RngCore;
use sha2::Sha256;
use std::fs::{self, File};
use std::io::{BufReader, BufWriter, Read, Write};
use std::path::{Path, PathBuf};
use uuid::Uuid;

type HmacSha256 = Hmac<Sha256>;

const MAGIC: &[u8; 5] = b"DSNE1";
const VERSION: u8 = 1;
const CHUNK_SIZE: usize = 4 * 1024 * 1024;
const HEADER_PREFIX_LEN: usize = 5 + 1 + 1 + 4 + 8 + 8;
const HEADER_LEN: usize = HEADER_PREFIX_LEN + 16;
const FRAME_HEADER_LEN: usize = 9;
const TAG_LEN: usize = 16;
const VAULT_LABEL: &[u8] = b"DeskNest vault v1";

pub fn validate_password(password: &str) -> Result<(), String> {
    if password.chars().count() < 6 {
        return Err("密码至少需要 6 个字符".to_string());
    }
    if password.chars().count() > 256 {
        return Err("密码过长".to_string());
    }
    Ok(())
}

pub fn create_vault(password: &str) -> Result<(VaultSettings, [u8; 32]), String> {
    validate_password(password)?;
    let mut salt = [0u8; 16];
    OsRng.fill_bytes(&mut salt);
    let key = derive_key(password, &salt)?;
    let verifier = vault_verifier(&key);
    Ok((
        VaultSettings {
            enabled: true,
            salt: hex::encode(salt),
            verifier: hex::encode(verifier),
            created_at: now_ms(),
        },
        key,
    ))
}

pub fn unlock_vault(settings: &VaultSettings, password: &str) -> Result<[u8; 32], String> {
    if !settings.enabled {
        return Err("尚未设置保险箱密码".to_string());
    }
    let salt = hex::decode(&settings.salt).map_err(|_| "保险箱盐值损坏".to_string())?;
    let expected =
        hex::decode(&settings.verifier).map_err(|_| "保险箱校验值损坏".to_string())?;
    let key = derive_key(password, &salt)?;
    let actual = vault_verifier(&key);
    if actual.as_slice() != expected.as_slice() {
        return Err("密码不正确".to_string());
    }
    Ok(key)
}

fn derive_key(password: &str, salt: &[u8]) -> Result<[u8; 32], String> {
    let params = Params::new(64 * 1024, 3, 4, Some(32))
        .map_err(|error| format!("密码参数错误：{error}"))?;
    let argon = Argon2::new(Algorithm::Argon2id, Version::V0x13, params);
    let mut key = [0u8; 32];
    argon
        .hash_password_into(password.as_bytes(), salt, &mut key)
        .map_err(|error| format!("密码派生失败：{error}"))?;
    Ok(key)
}

fn vault_verifier(key: &[u8; 32]) -> [u8; 32] {
    hmac_bytes(key, VAULT_LABEL)
}

fn hmac_bytes(key: &[u8; 32], data: &[u8]) -> [u8; 32] {
    let mut mac =
        <HmacSha256 as Mac>::new_from_slice(key).expect("HMAC key length");
    mac.update(data);
    let result = mac.finalize().into_bytes();
    let mut output = [0u8; 32];
    output.copy_from_slice(&result);
    output
}

fn file_check(key: &[u8; 32], header_prefix: &[u8]) -> [u8; 16] {
    let mac = hmac_bytes(key, header_prefix);
    let mut output = [0u8; 16];
    output.copy_from_slice(&mac[..16]);
    output
}

fn chunk_nonce(prefix: &[u8; 8], counter: u32) -> [u8; 12] {
    let mut nonce = [0u8; 12];
    nonce[..8].copy_from_slice(prefix);
    nonce[8..].copy_from_slice(&counter.to_le_bytes());
    nonce
}

fn chunk_aad(counter: u32, plain_len: u32, compression: u8) -> [u8; 9] {
    let mut aad = [0u8; 9];
    aad[..4].copy_from_slice(&counter.to_le_bytes());
    aad[4..8].copy_from_slice(&plain_len.to_le_bytes());
    aad[8] = compression;
    aad
}

fn compress_chunk(data: &[u8], enabled: bool) -> Result<(Vec<u8>, u8), String> {
    if !enabled || data.len() < 256 {
        return Ok((data.to_vec(), 0));
    }
    let mut encoder = DeflateEncoder::new(Vec::new(), Compression::fast());
    encoder
        .write_all(data)
        .map_err(|error| format!("分块压缩失败：{error}"))?;
    let compressed = encoder
        .finish()
        .map_err(|error| format!("分块压缩失败：{error}"))?;
    if compressed.len() + 32 < data.len() {
        Ok((compressed, 1))
    } else {
        Ok((data.to_vec(), 0))
    }
}

fn decompress_chunk(data: &[u8], plain_len: usize) -> Result<Vec<u8>, String> {
    let mut decoder = DeflateDecoder::new(Vec::with_capacity(plain_len));
    decoder
        .write_all(data)
        .map_err(|error| format!("分块解压失败：{error}"))?;
    decoder
        .finish()
        .map_err(|error| format!("分块解压失败：{error}"))
}

fn should_compress(path: &Path) -> bool {
    const COMPRESSIBLE: &[&str] = &[
        "txt", "md", "markdown", "json", "csv", "tsv", "log", "html", "htm", "css",
        "js", "mjs", "cjs", "ts", "tsx", "jsx", "rs", "py", "toml", "yaml", "yml",
        "xml", "svg", "sql", "ini", "cfg", "conf", "sh", "bat", "ps1",
    ];
    path.extension()
        .map(|extension| extension.to_string_lossy().to_lowercase())
        .map(|extension| COMPRESSIBLE.contains(&extension.as_str()))
        .unwrap_or(false)
}

pub fn encrypt_file(path: &Path, key: &[u8; 32]) -> Result<EncryptedFileMeta, String> {
    let metadata = fs::metadata(path).map_err(|error| format!("读取文件失败：{error}"))?;
    if !metadata.is_file() {
        return Err("只能加密普通文件".to_string());
    }
    let plain_size = metadata.len();
    let compression = should_compress(path);
    let temp = temporary_path(path);
    let result = (|| -> Result<u64, String> {
        let file = File::create(&temp).map_err(|error| format!("创建加密临时文件失败：{error}"))?;
        let mut writer = BufWriter::new(file);
        let mut prefix = Vec::with_capacity(HEADER_PREFIX_LEN);
        prefix.extend_from_slice(MAGIC);
        prefix.push(VERSION);
        prefix.push(0);
        prefix.extend_from_slice(&(CHUNK_SIZE as u32).to_le_bytes());
        prefix.extend_from_slice(&plain_size.to_le_bytes());
        let mut nonce_prefix = [0u8; 8];
        OsRng.fill_bytes(&mut nonce_prefix);
        prefix.extend_from_slice(&nonce_prefix);
        writer
            .write_all(&prefix)
            .map_err(|error| format!("写入加密头部失败：{error}"))?;
        writer
            .write_all(&file_check(key, &prefix))
            .map_err(|error| format!("写入加密校验失败：{error}"))?;

        let cipher = Aes256Gcm::new_from_slice(key)
            .map_err(|_| "加密器初始化失败".to_string())?;
        let mut input = BufReader::new(
            File::open(path).map_err(|error| format!("打开文件失败：{error}"))?,
        );
        let mut buffer = vec![0u8; CHUNK_SIZE];
        let mut counter: u32 = 0;
        loop {
            let read = input
                .read(&mut buffer)
                .map_err(|error| format!("读取文件失败：{error}"))?;
            if read == 0 {
                break;
            }
            let plain = &buffer[..read];
            let (payload, compression_flag) = compress_chunk(plain, compression)?;
            let plain_len = plain.len() as u32;
            let aad = chunk_aad(counter, plain_len, compression_flag);
            let ciphertext = cipher
                .encrypt(
                    Nonce::from_slice(&chunk_nonce(&nonce_prefix, counter)),
                    Payload {
                        msg: &payload,
                        aad: &aad,
                    },
                )
                .map_err(|_| "分块加密失败".to_string())?;
            writer
                .write_all(&(ciphertext.len() as u32).to_le_bytes())
                .map_err(|error| format!("写入分块长度失败：{error}"))?;
            writer
                .write_all(&plain_len.to_le_bytes())
                .map_err(|error| format!("写入分块长度失败：{error}"))?;
            writer
                .write_all(&[compression_flag])
                .map_err(|error| format!("写入分块标记失败：{error}"))?;
            writer
                .write_all(&ciphertext)
                .map_err(|error| format!("写入加密分块失败：{error}"))?;
            counter = counter
                .checked_add(1)
                .ok_or_else(|| "文件过大，分块计数器溢出".to_string())?;
        }
        writer
            .flush()
            .map_err(|error| format!("写入加密文件失败：{error}"))?;
        let size = fs::metadata(&temp)
            .map_err(|error| format!("读取加密文件失败：{error}"))?
            .len();
        Ok(size)
    })();

    let encrypted_size = match result {
        Ok(size) => size,
        Err(error) => {
            let _ = fs::remove_file(&temp);
            return Err(error);
        }
    };
    if let Err(error) = replace_file(path, &temp) {
        let _ = fs::remove_file(&temp);
        return Err(error);
    }
    Ok(EncryptedFileMeta {
        original_size: plain_size,
        encrypted_size,
        created_at: now_ms(),
    })
}

pub fn decrypt_file_to(path: &Path, key: &[u8; 32], destination: &Path) -> Result<u64, String> {
    if let Some(parent) = destination.parent() {
        fs::create_dir_all(parent).map_err(|error| format!("创建解密目录失败：{error}"))?;
    }
    let result = decrypt_stream(path, key, destination);
    if result.is_err() {
        let _ = fs::remove_file(destination);
    }
    result
}

pub fn decrypt_file_in_place(path: &Path, key: &[u8; 32]) -> Result<u64, String> {
    let temp = temporary_path(path);
    let result = decrypt_stream(path, key, &temp);
    let size = match result {
        Ok(size) => size,
        Err(error) => {
            let _ = fs::remove_file(&temp);
            return Err(error);
        }
    };
    if let Err(error) = replace_file(path, &temp) {
        let _ = fs::remove_file(&temp);
        return Err(error);
    }
    Ok(size)
}

fn decrypt_stream(path: &Path, key: &[u8; 32], destination: &Path) -> Result<u64, String> {
    let input_file =
        File::open(path).map_err(|error| format!("打开加密文件失败：{error}"))?;
    let mut reader = BufReader::new(input_file);
    let mut header = [0u8; HEADER_LEN];
    reader
        .read_exact(&mut header)
        .map_err(|_| "加密文件头部不完整".to_string())?;
    if &header[..5] != MAGIC {
        return Err("不是 DeskNet 加密文件".to_string());
    }
    if header[5] != VERSION {
        return Err("不支持的加密文件版本".to_string());
    }
    let chunk_size = u32::from_le_bytes(header[7..11].try_into().unwrap()) as usize;
    if chunk_size == 0 || chunk_size > 16 * 1024 * 1024 {
        return Err("加密文件分块参数异常".to_string());
    }
    let plain_size = u64::from_le_bytes(header[11..19].try_into().unwrap());
    let mut nonce_prefix = [0u8; 8];
    nonce_prefix.copy_from_slice(&header[19..27]);
    let expected_check = file_check(key, &header[..HEADER_PREFIX_LEN]);
    if expected_check.as_slice() != &header[HEADER_PREFIX_LEN..] {
        return Err("密码不正确或文件已损坏".to_string());
    }

    let output = File::create(destination)
        .map_err(|error| format!("创建解密临时文件失败：{error}"))?;
    let mut writer = BufWriter::new(output);
    let cipher =
        Aes256Gcm::new_from_slice(key).map_err(|_| "解密器初始化失败".to_string())?;
    let mut written: u64 = 0;
    let mut counter: u32 = 0;
    while written < plain_size {
        let mut frame = [0u8; FRAME_HEADER_LEN];
        reader
            .read_exact(&mut frame)
            .map_err(|_| "加密文件数据不完整".to_string())?;
        let stored_len = u32::from_le_bytes(frame[..4].try_into().unwrap()) as usize;
        let plain_len = u32::from_le_bytes(frame[4..8].try_into().unwrap()) as usize;
        let compression = frame[8];
        if stored_len == 0
            || stored_len > chunk_size + TAG_LEN + 64
            || plain_len == 0
            || plain_len > chunk_size
            || written + plain_len as u64 > plain_size
        {
            return Err("加密文件分块结构异常".to_string());
        }
        let mut ciphertext = vec![0u8; stored_len];
        reader
            .read_exact(&mut ciphertext)
            .map_err(|_| "加密文件数据不完整".to_string())?;
        let aad = chunk_aad(counter, plain_len as u32, compression);
        let plain = cipher
            .decrypt(
                Nonce::from_slice(&chunk_nonce(&nonce_prefix, counter)),
                Payload {
                    msg: &ciphertext,
                    aad: &aad,
                },
            )
            .map_err(|_| "解密失败：密码错误或文件已损坏".to_string())?;
        let data = if compression == 1 {
            decompress_chunk(&plain, plain_len)?
        } else if compression == 0 {
            plain
        } else {
            return Err("未知的分块压缩格式".to_string());
        };
        if data.len() != plain_len {
            return Err("分块长度校验失败".to_string());
        }
        writer
            .write_all(&data)
            .map_err(|error| format!("写入解密文件失败：{error}"))?;
        written += data.len() as u64;
        counter = counter
            .checked_add(1)
            .ok_or_else(|| "分块计数器溢出".to_string())?;
    }
    writer
        .flush()
        .map_err(|error| format!("完成解密写入失败：{error}"))?;
    if written != plain_size {
        return Err("解密后的大小与原文件不一致".to_string());
    }
    Ok(written)
}

pub fn decrypted_temp_path(directory: &Path, name: &str) -> PathBuf {
    let safe_name = Path::new(name)
        .file_name()
        .map(|value| value.to_string_lossy().to_string())
        .unwrap_or_else(|| "document".to_string());
    directory.join(format!("{}-{}", Uuid::new_v4(), safe_name))
}

fn temporary_path(path: &Path) -> PathBuf {
    let name = path
        .file_name()
        .map(|value| value.to_string_lossy().to_string())
        .unwrap_or_else(|| "file".to_string());
    path.with_file_name(format!(".desknest-{}-{name}.tmp", Uuid::new_v4()))
}

fn replace_file(original: &Path, replacement: &Path) -> Result<(), String> {
    let backup = original.with_file_name(format!(".desknest-bak-{}", Uuid::new_v4()));
    fs::rename(original, &backup).map_err(|error| format!("暂存原文件失败：{error}"))?;
    match fs::rename(replacement, original) {
        Ok(()) => {
            let _ = fs::remove_file(&backup);
            Ok(())
        }
        Err(error) => {
            let _ = fs::rename(&backup, original);
            Err(format!("替换文件失败：{error}"))
        }
    }
}
