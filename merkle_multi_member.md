#Merkle Multi Member Proofs


##Pseudo code and diagrams below

list_of_leaves = [0,1,2,3,4,5,6,7,8,9]

number_of_leaves = 10
selected_leaves = [0, 7, 9]


layers = reverse(recurse_proof(list_of_leaves, selected_leaves, number_of_leaves))


fn get_needed_hashes(layers, current_level){
    [layer, ..rest] = layers


    for item in layer{
        needed_items = [item]
        while current_level > 0{
            current_level = current_level -1

            needed_items = map(needed_items, fn(item){
                [item*2, item*2+1]
            })

            needed_items = flatten(needed_items)
        }


        needed_items = flatten(needed_items)

        for leaf1, leaf2 in needed_items{
            left = get(leaves, leaf1)
            right = get(leaves, leaf2)

            hash(left, right)
        }
    }


    get_needed_hashes(rest, current_level+1)

}



fn recurse_proof(layer, prev_selection, layer_length){
    needed = needed_leaves(prev_selection, layer_length)

    needed = filter(needed, fn(item){
        !contains(prev_selection, item)
    })

    next_needed  = map(needed, fn(leaf) { leaf/2})

    next_layer = map(layer, fn(leaf) { leaf/2})

    [needed, ..recurse_proof(next_layer, next_needed, layer_length/2)]

}


fn needed_leaves(selected_leaves, layer_length){
    [leaf, ..rest] = selected_leaves


    if leaf % 2 == 0{
        if leaf != layer_length-1{
            [leaf+1, ..needed_leaves(rest)]
        }
        else{
            []
        }
    }
    else {
        [leaf-1, ..needed_leaves(rest)
    }

}






[[1, 6, 8], [1, 2], [], []]




2nd layer grabs
[[2,3], [4, 5]]

leafs 1, 6, 8,


second layer 2,3


[0, 3, 4]

[0, 1]




               root
           /        \
           0         1
      /        \      \
     0          1      2
   /  \      /     \     \
  0    1     2     3     4
/  \  /  \  /  \  /  \  /  \
0, 1, 2, 3, 4, 5, 6, 7, 8, 9


[[0, 1, 6, 7, 8, 9], [1, 2], [], []]


Node(index, maybe_hash:"stuff" items:[])


[[Node(0, []), Node(1, []), Node(6, []), Node(7, []), Node(8, []), Node(9, [])], [Node(1, []), Node(2, [])], [], []]



match (layers) {
    [current, next, ..rest] -> {
            match (current){
            [] -> {}
            [x] -> next.ordered_insert(Node(x.index/2, [x]))
            [x, y] -> next.ordered_insert(Node(x.index/2, [x, y]))
        }

        recurse([next, ..rest])
    }
    [current] -> {


        match (current){
            [] -> {}
            [x] -> Node(x.index/2, [x])
            [x, y] -> Node(x.index/2, [x, y])
        }
    }
    [] -> impossible
}

[current, next, ..rest] = layers





Done_recursion when









[[], [
                              Node(0, [
                                    Node(0, []),
                                    Node(1, [])
                                    ]),
                              Node(1, []),
                              Node(2, []),
                              Node(3, [
                                Node(6, []),
                                Node(7, [])
                                ]),
                              Node(4, [
                                Node(8, []),
                                Node(9, [])
                                ])
      ],
[
Node(0, [0, 1]), Node(1, [2, 3], Node(2, [4])

], [
Node(0, [0, 1]), Node(1, [2]),
]]

Node(0, [0,1])
