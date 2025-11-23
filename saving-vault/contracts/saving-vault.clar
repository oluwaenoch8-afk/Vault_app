(define-constant err-profile-exists (err u100))
(define-constant err-no-profile (err u101))
(define-constant err-bad-voice (err u102))
(define-constant err-not-owner (err u103))
(define-constant err-not-found (err u104))
(define-constant err-already-revoked (err u105))

(define-data-var vault-counter uint u0)

(define-map user-profiles
  { owner: principal }
  { voice-hash: (buff 32), created-at: uint }
)

(define-map vault-items
  { id: uint }
  {
    owner: principal,
    uri: (string-ascii 256),
    media-type: (string-ascii 32),
    label: (string-ascii 64),
    created-at: uint,
    revoked: bool
  }
)

;; READ-ONLY HELPERS

(define-read-only (get-user-profile (who principal))
  (map-get? user-profiles { owner: who })
)

(define-read-only (get-vault-item (id uint))
  (map-get? vault-items { id: id })
)

(define-read-only (get-vault-counter)
  (var-get vault-counter)
)

(define-read-only (verify-voice (who principal) (voice-hash (buff 32)))
  (match (map-get? user-profiles { owner: who })
    profile
      (is-eq (get voice-hash profile) voice-hash)
    false
  )
)

;; PUBLIC FUNCTIONS

(define-public (register-voice (voice-hash (buff 32)))
  (match (map-get? user-profiles { owner: tx-sender })
    profile
      err-profile-exists
    (let ((now block-height))
      (map-set user-profiles { owner: tx-sender }
        { voice-hash: voice-hash, created-at: now })
      (ok true)
    )
  )
)

(define-public (update-voice (old-voice-hash (buff 32)) (new-voice-hash (buff 32)))
  (match (map-get? user-profiles { owner: tx-sender })
    profile
      (if (is-eq (get voice-hash profile) old-voice-hash)
          (begin
            (map-set user-profiles { owner: tx-sender }
              { voice-hash: new-voice-hash, created-at: (get created-at profile) })
            (ok true)
          )
          err-bad-voice)
    err-no-profile
  )
)

(define-private (assert-voice (who principal) (voice-hash (buff 32)))
  (match (map-get? user-profiles { owner: who })
    profile
      (if (is-eq (get voice-hash profile) voice-hash)
          (ok true)
          err-bad-voice)
    err-no-profile
  )
)

(define-public (add-vault-item
    (uri (string-ascii 256))
    (media-type (string-ascii 32))
    (label (string-ascii 64))
    (voice-hash (buff 32)))
  (match (assert-voice tx-sender voice-hash)
    ok-val
      (let ((next-id (+ u1 (var-get vault-counter)))
            (now block-height))
        (var-set vault-counter next-id)
        (map-set vault-items { id: next-id }
          {
            owner: tx-sender,
            uri: uri,
            media-type: media-type,
            label: label,
            created-at: now,
            revoked: false
          })
        (ok next-id)
      )
    err-code (err err-code)
  )
)

(define-public (revoke-vault-item (id uint) (voice-hash (buff 32)))
  (match (map-get? vault-items { id: id })
    item
      (if (is-eq (get owner item) tx-sender)
          (match (assert-voice tx-sender voice-hash)
            ok-val
              (if (get revoked item)
                  err-already-revoked
                  (begin
                    (map-set vault-items { id: id }
                      {
                        owner: (get owner item),
                        uri: (get uri item),
                        media-type: (get media-type item),
                        label: (get label item),
                        created-at: (get created-at item),
                        revoked: true
                      })
                    (ok true)
                  )
              )
            err-code (err err-code)
          )
          err-not-owner)
    err-not-found
  )
)

(define-public (transfer-vault-item
    (id uint)
    (recipient principal)
    (voice-hash (buff 32)))
  (match (map-get? vault-items { id: id })
    item
      (if (is-eq (get owner item) tx-sender)
          (if (get revoked item)
              err-already-revoked
              (match (assert-voice tx-sender voice-hash)
                ok-val
                  (begin
                    (map-set vault-items { id: id }
                      {
                        owner: recipient,
                        uri: (get uri item),
                        media-type: (get media-type item),
                        label: (get label item),
                        created-at: (get created-at item),
                        revoked: false
                      })
                    (ok true)
                  )
                err-code (err err-code)
              )
          )
          err-not-owner)
    err-not-found
  )
)
