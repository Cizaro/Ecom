import { countryOptions, type SavedAddress } from "@ecom/core";
import { AccountField, AccountSelect } from "./account-form";

/**
 * The fields of an address form. Labels are general because the country can
 * change after the page loads; the server checks each country's own rules
 * (required postal code, its format, required region) and says what is wrong.
 */
export function AddressFields({ address }: { address?: SavedAddress }) {
  return (
    <>
      <AccountField
        label="Full name"
        name="fullName"
        autoComplete="name"
        maxLength={200}
        required
        defaultValue={address?.fullName}
      />
      <AccountSelect
        label="Country"
        name="country"
        autoComplete="country"
        required
        defaultValue={address?.country ?? ""}
        options={[{ value: "", label: "Choose a country" }, ...countryOptions()]}
      />
      <AccountField
        label="Address"
        name="line1"
        autoComplete="address-line1"
        hint="Street and building number"
        maxLength={200}
        required
        defaultValue={address?.line1}
      />
      <AccountField
        label="Apartment, floor, landmark"
        name="line2"
        autoComplete="address-line2"
        hint="Optional"
        maxLength={200}
        defaultValue={address?.line2 ?? ""}
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <AccountField
          label="City"
          name="city"
          autoComplete="address-level2"
          maxLength={100}
          required
          defaultValue={address?.city}
        />
        <AccountField
          label="State, province or region"
          name="region"
          autoComplete="address-level1"
          hint="Where your country uses one"
          maxLength={100}
          defaultValue={address?.region ?? ""}
        />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <AccountField
          label="Postal or ZIP code"
          name="postalCode"
          autoComplete="postal-code"
          hint="Where your country uses one"
          maxLength={16}
          defaultValue={address?.postalCode ?? ""}
        />
        <AccountField
          label="Phone"
          name="phone"
          type="tel"
          autoComplete="tel"
          hint="Optional. For the courier."
          defaultValue={address?.phone ?? ""}
        />
      </div>
    </>
  );
}
