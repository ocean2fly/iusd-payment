/// Factory for GiftPool objects.
module ipay::gift_v1_factory {
    use initia_std::object::Object;
    use initia_std::fungible_asset::Metadata;
    use ipay::gift_v1::{Self, GiftPool};

    public entry fun create_pool(
        owner: &signer,
        iusd_fa: Object<Metadata>,
    ) {
        gift_v1::create_pool(owner, iusd_fa);
    }
}
