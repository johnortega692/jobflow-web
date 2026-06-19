/** Basic user contact info — stored in user_settings as signer_* fields. */

export type UserProfile = {
  name: string;
  title: string;
  phone: string;
  email: string;
};

export const emptyUserProfile = (): UserProfile => ({
  name: "",
  title: "",
  phone: "",
  email: "",
});
