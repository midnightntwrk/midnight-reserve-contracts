export declare const basicProtocolParameters: {
    coinsPerUtxoByte: number;
    minFeeReferenceScripts: {
        base: number;
        range: number;
        multiplier: number;
    };
    maxTxSize: number;
    minFeeCoefficient: number;
    minFeeConstant: number;
    maxBlockBodySize: number;
    maxBlockHeaderSize: number;
    stakeKeyDeposit: number;
    poolDeposit: number;
    poolRetirementEpochBound: number;
    desiredNumberOfPools: number;
    poolInfluence: string;
    monetaryExpansion: string;
    treasuryExpansion: string;
    minPoolCost: number;
    protocolVersion: {
        major: number;
        minor: number;
    };
    maxValueSize: number;
    collateralPercentage: number;
    maxCollateralInputs: number;
    costModels: Map<any, any>;
    prices: {
        memory: number;
        steps: number;
    };
    maxExecutionUnitsPerTransaction: {
        memory: number;
        steps: number;
    };
    maxExecutionUnitsPerBlock: {
        memory: number;
        steps: number;
    };
};
//# sourceMappingURL=protocol-params.d.ts.map