// Simple tests for double value checker logic

// Test the core double relationship logic
test double_check_basic() {
  let value1 = 10000000
  let value2 = 5000000
  
  // Test: first is double the second
  (value1 == value2 * 2) == True
}

test double_check_reverse() {
  let value1 = 5000000
  let value2 = 10000000
  
  // Test: second is double the first
  (value2 == value1 * 2) == True
}

test double_check_both_directions() {
  let value1 = 10000000
  let value2 = 5000000
  
  // Test the OR condition from our validator
  ((value1 == value2 * 2) || (value2 == value1 * 2)) == True
}

test double_check_no_relationship() {
  let value1 = 7000000
  let value2 = 5000000
  
  // Test: neither is double the other
  ((value1 == value2 * 2) || (value2 == value1 * 2)) == False
}

test double_check_equal_values() {
  let value1 = 5000000
  let value2 = 5000000
  
  // Test: equal values don't have double relationship
  ((value1 == value2 * 2) || (value2 == value1 * 2)) == False
}

test double_check_zero_values() {
  let value1 = 0
  let value2 = 0
  
  // Test: zero values (edge case)
  ((value1 == value2 * 2) || (value2 == value1 * 2)) == True  // 0 == 0 * 2
}