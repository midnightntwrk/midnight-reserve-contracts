graph TD

    %% All direct dependencies are handled compile time by aiken
    %% Logic contracts depend on their corresponding forever counterpart
    reserve_logic --> reserve_forever
    ics_logic --> ics_forever
    committee_bridge_logic --> committee_bridge_forever
    council_logic --> council_forever
    tech_auth_logic --> tech_auth_forever
    federated_ops_logic --> federated_ops_forever

    %% Forever contracts depend on their corresponding two-stage upgrade
    reserve_forever --> reserve_two_stage_upgrade
    ics_forever --> ics_two_stage_upgrade
    committee_bridge_forever --> committee_bridge_two_stage_upgrade
    council_forever --> council_two_stage_upgrade
    tech_auth_forever --> tech_auth_two_stage_upgrade
    federated_ops_forever --> federated_ops_two_stage_upgrade

    %% Simple bridge validator (no upgrade pattern)
    simple_bridge

    %% Auth validators depend on thresholds and forever contracts
    main_gov_auth --> main_gov_threshold
    main_gov_auth --> tech_auth_forever
    main_gov_auth --> council_forever

    staging_gov_auth --> staging_gov_threshold
    staging_gov_auth --> main_gov_threshold
    staging_gov_auth --> tech_auth_forever
    staging_gov_auth --> council_forever

    %% Logic validators depend on threshold validators for multisig updates
    council_logic --> main_council_update_threshold
    tech_auth_logic --> main_tech_auth_update_threshold
    federated_ops_logic --> main_federated_ops_update_threshold

    %% Additional dependencies from logic_multisig_validation_nft_input
    council_logic --> tech_auth_forever
    tech_auth_logic --> council_forever
    federated_ops_logic --> tech_auth_forever
    federated_ops_logic --> council_forever

    %% Threshold validators depend on forever contracts
    main_gov_threshold --> tech_auth_forever
    main_gov_threshold --> council_forever
    staging_gov_threshold --> tech_auth_forever
    staging_gov_threshold --> council_forever
    main_council_update_threshold --> tech_auth_forever
    main_council_update_threshold --> council_forever
    main_tech_auth_update_threshold --> tech_auth_forever
    main_tech_auth_update_threshold --> council_forever
    main_federated_ops_update_threshold --> tech_auth_forever
    main_federated_ops_update_threshold --> council_forever

    %% Indirect relationships via onchain state
    reserve_two_stage_upgrade -.-> main_gov_auth
    reserve_two_stage_upgrade -.-> staging_gov_auth
    reserve_forever -.-> reserve_logic
    ics_two_stage_upgrade -.-> main_gov_auth
    ics_two_stage_upgrade -.-> staging_gov_auth
    ics_forever -.-> ics_logic
    committee_bridge_two_stage_upgrade -.-> main_gov_auth
    committee_bridge_two_stage_upgrade -.-> staging_gov_auth
    committee_bridge_forever -.-> committee_bridge_logic
    council_two_stage_upgrade -.-> main_gov_auth
    council_two_stage_upgrade -.-> staging_gov_auth
    council_forever -.-> council_logic
    tech_auth_two_stage_upgrade -.-> main_gov_auth
    tech_auth_two_stage_upgrade -.-> staging_gov_auth
    tech_auth_forever -.-> tech_auth_logic
    federated_ops_two_stage_upgrade -.-> main_gov_auth
    federated_ops_two_stage_upgrade -.-> staging_gov_auth
    federated_ops_forever -.-> federated_ops_logic
