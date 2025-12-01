use aiken/builtin
use aiken/collection/list
use aiken/primitive/bytearray

pub const validator_set =
  [
    #"020a1091341fe5664bfa1782d5e04779689068c916b04cb365ec3153755684d9a1",
    #"0390084fdbf27d2b79d26a4f13f0ccd982cb755a661969143c37cbc49ef5b91f27",
    #"0389411795514af1627765eceffcbd002719f031604fadd7d188e2dc585b4e1afb",
    #"03bc9d0ca094bd5b8b3225d7651eac5d18c1c04bf8ae8f8b263eebca4e1410ed0c",
    #"031d10105e323c4afce225208f71a6441ee327a65b9e646e772500c74d31f669aa",
    #"0291f1217d5a04cb83312ee3d88a6e6b33284e053e6ccfc3a90339a0299d12967c",
    #"036c6ae73d36d0c02b54d7877a57b1734b8e096134bd2c1b829431aa38f18bcce1",
    #"020a617391de0e0291310bf7792bb41d9573e8a054b686205da5553e08fac6d0b8",
    #"03c766411432fae7483fe9f0c175985fbbc5ca108bffb5b94db7d52dafd6f98bea",
    #"02b8beaa492309f2332dd5445e20b8f74e26336c226daecf63cc4cd95a1ef3b140",
    #"0287aa09f21089003413b37602a3f6909f8695901c70a28175cafd99d5976a202a",
    #"035d35454a9671ccf959def176822d38e9e9aa5bbcfe50a7cbe69834dde9147ce5",
  ]

pub const leaves =
  list.map(
    validator_set,
    fn(x) {
      bytearray.concat(
        x |> builtin.keccak_256,
        1000 |> builtin.integer_to_bytearray(True, 0, _),
      )
    },
  )
