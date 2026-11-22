// vanilla_transaction and the helpers it calls, copied from
// utxo-company/audit-lava-smart-contracts, src/templates/report.typ. One change:
// the valid range reads as POSIX ms, as scripts see it, with the exclusive upper bound.

#let tx_out_height_estimate(input) = {
  let address = if "address" in input { 1 } else { 0 }
  let value = if "value" in input { input.value.len() } else { 0 }
  let datum = if "datum" in input { input.datum.len() } else { 0 }
  return (address + value + datum) * 8pt
}

#let datum_field(indent, k, val) = [
  #if val == "" [
    #h(indent)\+ #raw(k)
  ] else [
    #h(indent)\+ #raw(k):
    #if type(val) == content { val }
    #if type(val) == str and val != "" { repr(val) }
    #if type(val) == int { repr(val) }
    #if type(val) == array [
      #stack(dir: ttb, spacing: 0.4em, for item in val [
        #datum_field(indent + 1.2em, "", item) \
      ])
    ]
    #if type(val) == dictionary [
      #v(-0.7em)
      #stack(dir: ttb, spacing: 0em, for (k, v) in val.pairs() [
        #datum_field(indent + 1.2em, k, v) \
      ])
    ]
  ]
]

#let tx_out(input, position, inputHeight) = {
  let address = if "address" in input [
    *Address: #h(0.5em) #input.address*
  ] else []
  let value = if "value" in input [
    *Value:* #if ("ada" in input.value) [ *#input.value.ada* ADA ] \
    #v(-1.0em)
    #stack(dir: ttb, spacing: 0.4em, ..input
      .value
      .pairs()
      .map(((k, v)) => [
        #if k != "ada" [
          #h(2.3em) \+
          #if type(v) == content { math.bold(v) }
          #if type(v) == str and v != "" [*#v*]
          #k
        ]
      ]))
  ] else []
  let datum = if "datum" in input [
    *Datum:* \
    #v(-0.8em)
    #stack(dir: ttb, spacing: 0.4em, ..input
      .datum
      .pairs()
      .map(((k, val)) => datum_field(1.2em, k, val)))
  ] else []
  let reference_script = if "reference_script" in input [
    *Reference Script:* #h(0.1em) #input.reference_script
  ] else []
  let addressHeight = (
    measure(address).height + if "address" in input { 6pt } else { 0pt }
  )
  let valueHeight = (
    measure(value).height + if "value" in input { 6pt } else { 0pt }
  )
  let datumHeight = (
    measure(datum).height + if "datum" in input { 6pt } else { 0pt }
  )
  let referenceScriptHeight = (
    measure(reference_script).height
      + if "reference_script" in input { 6pt } else { 0pt }
  )
  let thisHeight = (
    32pt + addressHeight + valueHeight + datumHeight + referenceScriptHeight
  )

  if "dots" in input {
    return (
      content: place(dx: position.x, dy: position.y, [
        #place(dx: 4em, dy: -1em)[*.*]
        #place(dx: 4em, dy: 0em)[*.*]
        #place(dx: 4em, dy: 1em)[*.*]
      ]),
      height: thisHeight,
    )
  } else {
    return (
      content: place(dx: position.x, dy: position.y, [
        *#input.name*
        #line(start: (-4em, -1em), end: (10em, -1em), stroke: red)
        #place(dx: 10em, dy: -1.5em)[#circle(
          radius: 0.5em,
          fill: white,
          stroke: red,
        )]
        #if "address" in input { place(dx: 0em, dy: -3pt)[#address] }
        #place(dx: 0em, dy: addressHeight)[#value]
        #if "datum" in input {
          place(dx: 0em, dy: addressHeight + valueHeight)[#datum]
        }
        #if "reference_script" in input {
          place(
            dx: 0em,
            dy: addressHeight + valueHeight + datumHeight,
          )[#reference_script]
        }
      ]),
      height: thisHeight,
    )
  }
}

#let vanilla_transaction(
  name,
  inputs: (),
  outputs: (),
  signatures: (),
  certificates: (),
  withdraws: (),
  mint: (:),
  validRange: none,
  notes: none,
  donation: none,
) = context {
  let inputHeightEstimate = inputs.fold(0pt, (sum, input) => (
    sum + tx_out_height_estimate(input)
  ))
  let inputHeight = 0em
  let inputs = [
    #let start = (x: -18em, y: 1em)
    #for input in inputs {
      let tx_out = tx_out(input, start, inputHeight)

      tx_out.content

      let hasRedeemer = input.at("redeemer", default: none) != none
      // Now connect this output to the transaction
      if not "dots" in input {
        place(dx: start.x + 10.5em, dy: start.y + 0.84em)[
          #let lineStroke = if input.at("reference", default: false) {
            (paint: blue, thickness: 1pt, dash: "dashed")
          } else if hasRedeemer {
            rgb("#b102a6")
          } else {
            blue
          }
          #line(start: (0em, 0em), end: (7.44em, 0em), stroke: lineStroke)
        ]
        place(dx: start.x + 10.26em, dy: start.y + 0.59em)[
          #circle(radius: 0.25em, fill: if hasRedeemer { rgb("#b102a6") } else {
            blue
          })
        ]
      }
      if hasRedeemer {
        place(dx: start.x + 12.26em, dy: start.y - 0.2em)[#input.at("redeemer")]
      }

      start = (x: start.x, y: start.y + tx_out.height)
      inputHeight += tx_out.height
    }
  ]

  let outputHeightEstimate = outputs.fold(0pt, (sum, output) => (
    sum + tx_out_height_estimate(output)
  ))
  let outputHeight = 0em
  let outputs = [
    #let start = (x: 4em, y: 1em)
    #for output in outputs {
      let tx_out = tx_out(output, start, outputHeight)
      tx_out.content
      start = (x: start.x, y: start.y + tx_out.height)
      outputHeight += tx_out.height
    }
  ]

  // Collapse down the `mint` array
  let display_mint = (:)
  for (k, v) in mint {
    let has_variables = (
      v.variables.len() > 0 and v.variables.values().any(v => v != 0)
    )
    if v.qty == 0 and not has_variables {
      continue
    }
    let display = []
    if v.qty != 0 {
      display = if v.qty > 0 { [\+] } + [#v.qty]
    }
    let vs = v.variables.pairs().sorted(key: ((k, v)) => -v)
    if vs.len() > 0 {
      for (k, v) in vs {
        if v == 0 {
          continue
        } else if v > 0 {
          display += [ \+ ]
        } else if v < 0 {
          display += [ \- ]
        }
        if v > 1 or v < -1 {
          display += [#calc.abs(v)]
        }
        display += [*#k*]
      }
    }
    display += [ *#raw(k)*]
    display_mint.insert(k, display)
  }

  let mints = if display_mint.len() > 0 [
    *Mint:* \
    #for (k, v) in display_mint [
      #v \
    ]
    #v(1em)
  ] else []
  let sigs = if signatures.len() > 0 [
    *Signatures:* \
    #for signature in signatures [
      - #signature
    ]
    #v(1em)
  ] else []
  let certs = if certificates.len() > 0 [
    *Certificates:*
    #for certificate in certificates [
      - #certificate
    ]
    #v(1em)
  ] else []
  let withs = if withdraws.len() > 0 [
    *Withdraws: *
    #for withdraw in withdraws [
      - #withdraw
    ]
    #v(1em)
  ] else []
  let valid_range = if validRange != none [
    *Valid Range:* \
    #if "lower" in validRange [#validRange.lower $<=$ ]
    POSIX ms
    #if "upper" in validRange [$<$ #validRange.upper]
    #v(1em)
  ] else []
  let donation_ = if donation != none [
    *Donation:* #donation
  ] else []

  let boxHeight = (
    100pt
      + if certificates.len() > 0 { 32pt * certificates.len() } else { 0pt }
      + if signatures.len() > 0 { 32pt * signatures.len() } else { 0pt }
      + if withdraws.len() > 0 { 40pt * withdraws.len() }
      + if valid_range != none { 20pt } else { 0pt }
  )

  let transaction = [
    #set align(center)
    #rect(
      radius: 4pt,
      height: calc.max(boxHeight, inputHeight + 16pt, outputHeight + 16pt),
      [
        #pad(top: 1em, name)
        #v(1em)
        #set align(left)
        #stack(
          dir: ttb,
          spacing: none,
          mints,
          sigs,
          certs,
          withs,
          valid_range,
          donation_,
        )
      ],
    )
  ]

  let diagram = stack(dir: ltr, inputs, transaction, outputs)
  let size = measure(diagram)
  let notes_content = if notes != none [ *Note*: #notes ] else []
  let notes_height = measure(notes_content).height
  block(width: 100%, height: size.height + notes_height + if notes != none { 16pt } else { 0pt })[
    #set align(center)
    #diagram
    #notes_content
  ]
}

// Not from the audit template: a left-aligned note of fixed width, so that
// vanilla_transaction's measure() sees its wrapped height.
#let note(body, width: 74em) = block(width: width, align(left, body))

// The order sentence for every diagram with more than one input.
#let unordered = [Inputs and reference inputs appear in no particular order. The ledger sorts them by transaction id and output index, and no script depends on their position.]
