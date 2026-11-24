//! The sibling-path partial tree must agree with the full ledger on every
//! write, and reject witnesses that do not open the root.

use qledger_core::*;
use sha2::{Digest, Sha256};

struct Rng(u64);
impl Rng {
    fn next(&mut self) -> u64 {
        self.0 ^= self.0 << 13;
        self.0 ^= self.0 >> 7;
        self.0 ^= self.0 << 17;
        self.0
    }
    fn id(&mut self, pool: u64) -> [u8; 32] {
        Sha256::digest(self.next().wrapping_rem(pool).to_be_bytes()).into()
    }
}

#[test]
fn random_writes_match_the_full_ledger() {
    for seed in 1..=40u64 {
        let mut r = Rng(seed * 0x9E37_79B9_7F4A_7C15);
        let mut parent = QledgerLedger::new();
        for _ in 0..(r.next() % 50) {
            let id = r.id(80);
            parent.put(&id, r.next() % 1000 + 1, r.next() % 5);
        }
        // Touched set: some present, some absent, with shared prefixes.
        let mut ids: Vec<[u8; 32]> = (0..(r.next() % 12 + 1)).map(|_| r.id(80)).collect();
        ids.sort();
        ids.dedup();
        let ws: Vec<_> = ids.iter().map(|id| parent.witness(id)).collect();
        let mut pt = QledgerPartialTree::new(&parent.root(), &ws).unwrap();
        let mut full = parent.clone();
        for _ in 0..30 {
            let id = ids[(r.next() % ids.len() as u64) as usize];
            let (b, n) = if r.next().is_multiple_of(5) {
                (0, 0)
            } else {
                (r.next() % 5000, r.next() % 9)
            };
            pt.set(&id, b, n).unwrap();
            full.put(&id, b, n);
            assert_eq!(pt.root(), full.root(), "seed {seed}");
            assert_eq!(pt.get(&id).unwrap(), (b, n));
        }
        // An id outside the opened set is refused.
        let stranger = [0xAAu8; 32];
        if !ids.contains(&stranger) {
            assert!(matches!(
                pt.get(&stranger),
                Err(QledgerError::IncompleteWitness)
            ));
        }
    }
}

#[test]
fn rejects_witnesses_that_do_not_open_the_root() {
    let mut led = QledgerLedger::new();
    for i in 0..10u64 {
        led.put(&Sha256::digest(i.to_be_bytes()).into(), 100 + i, 1);
    }
    let id: [u8; 32] = Sha256::digest(3u64.to_be_bytes()).into();
    let good = led.witness(&id);
    assert!(QledgerPartialTree::new(&led.root(), std::slice::from_ref(&good)).is_ok());

    let mut w = good.clone();
    w.balance += 1;
    assert!(
        QledgerPartialTree::new(&led.root(), &[w]).is_err(),
        "inflated balance"
    );

    let mut w = good.clone();
    w.siblings[0][0] ^= 1;
    assert!(
        QledgerPartialTree::new(&led.root(), &[w]).is_err(),
        "bad sibling"
    );

    let mut w = good.clone();
    w.siblings.push([7u8; 32]);
    assert!(
        QledgerPartialTree::new(&led.root(), &[w]).is_err(),
        "extra sibling"
    );

    let mut w = good.clone();
    w.bitmap = [0u8; 32];
    assert!(
        QledgerPartialTree::new(&led.root(), &[w]).is_err(),
        "bitmap dropped"
    );
}

#[test]
fn hand_padded_hashes_match_sha256() {
    // Empty leaf and every level of the constant table.
    let mut e: [u8; 32] = Sha256::new()
        .chain_update([0x00])
        .chain_update(b"qledger/v1/empty")
        .finalize()
        .into();
    assert_eq!(qledger_empty_hash(0), e);
    for h in 1..=QLEDGER_DEPTH {
        e = Sha256::new()
            .chain_update([0x01])
            .chain_update(e)
            .chain_update(e)
            .finalize()
            .into();
        assert_eq!(qledger_empty_hash(h), e, "level {h}");
    }
    let id = [0x5Au8; 32];
    let want: [u8; 32] = Sha256::new()
        .chain_update([0x00])
        .chain_update(id)
        .chain_update(7u64.to_be_bytes())
        .chain_update(9u64.to_be_bytes())
        .finalize()
        .into();
    assert_eq!(qledger_leaf_hash(&id, 7, 9), want);
}
