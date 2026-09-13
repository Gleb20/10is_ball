import { StrictMode } from "react";
import { act,fireEvent,render,screen,waitFor } from "@testing-library/react";
import { afterEach,beforeEach,expect,it,vi } from "vitest";
import { MemoryRouter, useLocation } from "react-router-dom";
import { InvitationNotice } from "./InvitationNotice";
const mock=vi.hoisted(()=>({notifications:vi.fn(),markNotificationRead:vi.fn()}));
vi.mock("./api",()=>({api:mock}));
beforeEach(()=>{vi.clearAllMocks();mock.markNotificationRead.mockResolvedValue({});});afterEach(()=>vi.useRealTimers());
const future=()=>new Date(Date.now()+600000).toISOString();
it("GAP-008 shows one fresh invitation, dismisses it persistently and skips read/expired",async()=>{
 mock.notifications.mockResolvedValue({notifications:[{id:"expired",title:"Истекло",type:"match_invitation",actionable:true,expiresAt:"2000-01-01T00:00:00Z"},{id:"read",title:"Прочитано",type:"team_invitation",actionable:true,readAt:future(),expiresAt:future()},{id:"one",title:"Первое приглашение",body:"В матч",type:"match_invitation",actionable:true,readAt:null,expiresAt:future()},{id:"two",title:"Второе приглашение",type:"judge_invitation",actionable:true,readAt:null,expiresAt:future()}]});
 render(<MemoryRouter><InvitationNotice userId="u" enabled /></MemoryRouter>);
 expect(await screen.findByText("Первое приглашение")).toBeVisible();expect(screen.queryByText("Второе приглашение")).not.toBeInTheDocument();
 fireEvent.click(screen.getByRole("button",{name:"Закрыть уведомление"}));await waitFor(()=>expect(mock.markNotificationRead).toHaveBeenCalledWith("one"));
 expect(screen.queryByText("Первое приглашение")).not.toBeInTheDocument();
});
it("GAP-008 immersive judge and tutorial routes never fetch a popup",()=>{
 render(<MemoryRouter initialEntries={["/matches/m/judge?tutorial=1"]}><InvitationNotice userId="u" enabled /></MemoryRouter>);expect(mock.notifications).not.toHaveBeenCalled();
});
it("GAP-008 a shown notice disappears at its exact expiration",async()=>{
 vi.useFakeTimers();const expiry=new Date(Date.now()+1000).toISOString();mock.notifications.mockResolvedValue({notifications:[{id:"x",title:"Короткое",type:"match_invitation",actionable:true,expiresAt:expiry}]});
 render(<MemoryRouter><InvitationNotice userId="u" enabled /></MemoryRouter>);await act(async()=>{await Promise.resolve();});expect(screen.getByText("Короткое")).toBeVisible();await act(async()=>{vi.advanceTimersByTime(1000);});expect(screen.queryByText("Короткое")).not.toBeInTheDocument();
});

it("GAP-008 notice survives StrictMode effect replay",async()=>{
 mock.notifications.mockResolvedValue({notifications:[{id:"strict",title:"Новое в строгом режиме",type:"match_invitation",actionable:true,expiresAt:future()}]});
 render(<StrictMode><MemoryRouter><InvitationNotice userId="u" enabled /></MemoryRouter></StrictMode>);
 expect(await screen.findByText("Новое в строгом режиме")).toBeVisible();
});
it("GAP-008 previous actor dismiss response cannot navigate the new actor",async()=>{
 let resolveRead!:(value:unknown)=>void;mock.markNotificationRead.mockImplementationOnce(()=>new Promise(resolve=>{resolveRead=resolve;}));
 mock.notifications.mockResolvedValueOnce({notifications:[{id:"a",title:"Приглашение A",type:"match_invitation",actionable:true,expiresAt:future()}]}).mockResolvedValue({notifications:[]});
 function Route(){return <output data-testid="route">{useLocation().pathname}</output>;}
 const view=render(<MemoryRouter><InvitationNotice userId="a" enabled/><Route/></MemoryRouter>);
 fireEvent.click(await screen.findByRole("button",{name:"Открыть уведомления"}));
 view.rerender(<MemoryRouter><InvitationNotice userId="b" enabled/><Route/></MemoryRouter>);
 await act(async()=>{resolveRead({ok:true});});
 expect(screen.getByTestId("route")).toHaveTextContent(/^\/$/);
});
