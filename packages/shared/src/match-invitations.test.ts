import { expect,it } from "vitest";
import { CreateMatchRequestSchema, UpdateMatchRequestSchema, MatchInvitationRequestSchema } from "./index.js";
const id="00000000-0000-4000-8000-000000000001";
const create={title:"Match",format:"1v1",participants:[{side:"A",userId:id},{side:"B",guestFirstName:"Guest",guestLastName:"Test"}]};
it("accepts an optional judge but rejects invalid identity and create-side retained IDs",()=>{
 expect(CreateMatchRequestSchema.safeParse({...create,judgeUserId:id}).success).toBe(true);
 expect(CreateMatchRequestSchema.safeParse({...create,judgeUserId:"wrong"}).success).toBe(false);
 expect(CreateMatchRequestSchema.safeParse({...create,participants:[{...create.participants[0],id},create.participants[1]]}).success).toBe(false);
});
it("patch retains explicit participant IDs while rejecting empty/immutable/malformed data",()=>{
 expect(UpdateMatchRequestSchema.safeParse({participants:[{id,side:"A",userId:id},{side:"B",guestFirstName:"Guest",guestLastName:"Test"}]}).success).toBe(true);
 for(const body of [{},{source:"revenge"},{participants:[{side:"A",userId:id,guestFirstName:"Bad"}]},{participants:[{id:"bad",side:"A",userId:id}]}]) expect(UpdateMatchRequestSchema.safeParse(body).success).toBe(false);
});
it("invitation requests have a bounded kind and valid target",()=>{
 expect(MatchInvitationRequestSchema.parse({userId:id,kind:"judge"})).toEqual({userId:id,kind:"judge"});
 expect(MatchInvitationRequestSchema.safeParse({userId:id,kind:"other"}).success).toBe(false);
});
